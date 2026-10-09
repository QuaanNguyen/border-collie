import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def collect(directory, native=False):
    plan = json.loads((directory / 'official-plan.json').read_text())
    evaluator = Path(__file__).with_name('evaluate-sol-experiment.js') if native else directory / 'evaluation-code/guard/prototype/evaluate-sol-experiment.js'
    runtime_path = directory / 'evaluation-runtime.json'
    runtime = json.loads(runtime_path.read_text()) if runtime_path.exists() and not native else {}
    node_command = ['node']
    if runtime:
        container = Path(runtime['container'])
        if digest(container) != runtime['containerSha256']:
            raise RuntimeError('Evaluation container changed')
        node_command = [runtime['executable'], 'exec', '--bind', f'{directory}:{directory}', str(container), str(directory / 'runtime/node/bin/node')]
    cases = [('shipped-base', 0, None, False, directory / 'shipped-base', None), ('base-local-export', 0, None, False, directory / 'base-local-export', directory / 'base-local-export/candidate.cact')]
    historical_weights = directory / 'prior-custom-300-seed42/candidate.cact'
    if historical_weights.exists():
        if digest(historical_weights) != plan['priorCustomRun']['candidateSha256']:
            raise RuntimeError('Historical custom candidate changed')
        cases.append(('prior-custom-300-seed42', 300, 42, False, historical_weights.parent, historical_weights))
    failures, rows = [], []
    temporary = Path(tempfile.mkdtemp(prefix='needle-evaluation-'))
    local_base = temporary / 'base'
    base_source = Path(os.environ['BORDER_COLLIE_JUDGE_ROOT']) if native else directory / 'judge-root'
    shutil.copytree(base_source, local_base)
    evaluation_environment = {**os.environ, 'BORDER_COLLIE_JUDGE_ROOT': str(local_base), 'BORDER_COLLIE_EVALUATION_CACHE': str(temporary / 'cache'), 'BORDER_COLLIE_EVALUATION_THREADS': '4'}
    runtime['workerThreads'] = 4
    runtime['modelStorage'] = 'Hash-verified compute-node local copies during evaluation; archived weights remain on shared storage.'
    for setting in plan['runs']:
        destination = directory / setting['label']
        record_path = destination / 'run.json'
        if not record_path.exists():
            failures.append({'label': setting['label'], 'error': 'No completed run record'})
            continue
        record = json.loads(record_path.read_text())
        if record.get('status') != 'complete':
            failures.append({'label': setting['label'], 'error': record.get('error', record.get('status'))})
            continue
        weights = destination / 'candidate.cact'
        if digest(weights) != record['candidateSha256']:
            failures.append({'label': setting['label'], 'error': 'Export hash mismatch'})
            continue
        cases.append((setting['label'], setting['size'], setting['seed'], setting['reasoning'], destination, weights))
    for label, size, seed, reasoning, destination, weights in cases:
        try:
            destination.mkdir(exist_ok=True)
            for name in ['validation-scenarios.jsonl', 'held-out-scenarios.jsonl']:
                source = directory / name
                if digest(source) != plan['hashes'][name]:
                    raise RuntimeError('Frozen evaluation set changed')
                shutil.copyfile(source, destination / name)
            experiment = {'seed': seed, 'hashes': plan['hashes'], 'distributions': {'train': {'count': size}}}
            (destination / 'experiment.json').write_text(json.dumps(experiment, indent=2) + '\n')
            command = node_command + [str(evaluator), str(destination), label]
            if weights:
                local_weights = temporary / (label + '.cact')
                shutil.copyfile(weights, local_weights)
                if digest(local_weights) != digest(weights):
                    raise RuntimeError('Local evaluation copy changed')
                command.append(str(local_weights))
            with (destination / 'native-evaluation.log').open('w') as output:
                subprocess.run(command, stdout=output, stderr=subprocess.STDOUT, check=True, env=evaluation_environment)
            record = json.loads((destination / 'run.json').read_text()) if (destination / 'run.json').exists() else {}
            for split in ['validation', 'heldOut']:
                report = json.loads((destination / f'{label}-{split}.json').read_text())
                metrics = report['metrics']
                recalls = [metrics['confusion'][verdict][verdict] / sum(metrics['confusion'][verdict].values()) for verdict in ['allow', 'disallow', 'ask']]
                rows.append({'model': label, 'split': split, 'training_samples': size, 'seed': seed, 'reasoning_targets': reasoning, 'platform': report['platform'], 'total': metrics['total'], 'correct': metrics['correct'], 'accuracy': metrics['correct'] / metrics['total'], 'balanced_accuracy': sum(recalls) / len(recalls), 'allow_recall': recalls[0], 'disallow_recall': recalls[1], 'ask_recall': recalls[2], 'harmful_allowed_rate': metrics['harmfulAllowed']['rate'], 'ordinary_refused_rate': metrics['ordinaryRefused']['rate'], 'ask_precision': metrics['askPrecision']['rate'], 'no_verdict': metrics['noVerdict'], 'infrastructure_errors': metrics['infrastructureErrors'], 'final_validation_loss': record.get('finalValidationLoss'), 'minimum_validation_loss': record.get('minimumValidationLoss'), 'training_seconds': record.get('trainingSeconds'), 'official_validation_correct': record.get('officialValidationExactCalls', {}).get('correct'), 'weights_sha256': report['artifact']['weights']['sha256'] if 'weights' in report['artifact'] else report['artifact'].get('weightsSha256'), 'evaluation_set_sha256': report['evaluationSetSha256']})
            print(f'Completed native evaluation: {label}', flush=True)
        except Exception as error:
            failures.append({'label': label, 'error': str(error)})
    if rows:
        with (directory / 'batch-comparison.csv').open('w') as output:
            writer = csv.DictWriter(output, fieldnames=rows[0].keys())
            writer.writeheader()
            writer.writerows(rows)
    report = {'status': 'complete' if not failures else 'incomplete', 'finishedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'slurmJobId': os.environ.get('SLURM_JOB_ID'), 'planSha256': digest(directory / 'official-plan.json'), 'platform': rows[0]['platform'] if rows else None, 'evaluationRuntime': runtime, 'rows': rows, 'failures': failures, 'interpretation': 'Compare validation metrics to choose settings. Held-out metrics are descriptive. Mac pilot and Linux batch runtime results use the same pinned revision but are separate platform measurements.'}
    (directory / 'batch-comparison.json').write_text(json.dumps(report, indent=2) + '\n')
    environment = {**os.environ, 'PYTHONPATH': str(directory / 'runtime/plotting'), 'MPLCONFIGDIR': str(directory / 'runtime/matplotlib-cache')}
    if rows:
        subprocess.run([sys.executable, str(Path(__file__).with_name('plot-needle-ladder.py')), str(directory)], env=environment, check=True)
    shutil.rmtree(temporary)
    if failures:
        raise RuntimeError('Some runs or evaluations failed; inspect batch-comparison.json')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    parser.add_argument('--native', action='store_true')
    args = parser.parse_args()
    collect(args.directory.resolve(), args.native)
