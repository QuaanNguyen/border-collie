import argparse
import csv
import hashlib
import importlib.metadata
import inspect
import json
import math
import os
from pathlib import Path
import re
import shutil
import socket
import struct
import subprocess
import tempfile
import time


def digest(path):
    with Path(path).open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def save(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def rows(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def archive_audit(path):
    with path.open('rb') as handle:
        header = struct.unpack('<48If', handle.read(196))
        if header[0] != 0x05E12A84 or header[10] != 20:
            raise RuntimeError('Expected a full-depth Needle 3 archive')
        handle.seek(header[2] * 4, 1)
        records = [struct.unpack('<BBHIIIIQQII', handle.read(44)) for _ in range(header[1])]
        quantized = [record for record in records if record[0] == 3]
        if not quantized or any(record[10] != 4 for record in quantized):
            raise RuntimeError('Only 4-bit quantized weights are permitted')
        if records[-2][0] != 1 or records[-2][1] != 1 or records[-2][3] != header[7] or records[-1][0] != 4:
            raise RuntimeError('Expected final norm followed by tokenizer, with no probe heads')
        handle.seek(records[-1][7])
        tokenizer_hash = hashlib.sha256(handle.read(records[-1][8])).hexdigest()
    return {'quantizedWeightBits': 4, 'quantizedTensors': len(quantized), 'layers': header[10], 'confidenceHeadPresent': False, 'tokenizerSha256': tokenizer_hash, 'weightsSha256': digest(path)}


def load_plan(directory):
    plan = json.loads((directory / 'study-plan.json').read_text())
    for name, expected in plan['hashes'].items():
        if digest(directory / name) != expected:
            raise RuntimeError('Frozen data changed: ' + name)
    return plan


def command_log(command, destination):
    started = time.monotonic()
    epochs, steps = [], []
    with (destination / ('training.log' if command[1] == 'finetune' else 'build.log')).open('w') as handle:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        for line in process.stdout:
            handle.write(line)
            handle.flush()
            print(line.rstrip(), flush=True)
            epoch = re.search(r'epoch\s+(\d+)/(\d+)\s+loss\s+([\d.e+-]+)\s+val\s+([\d.e+-]+)', line)
            step = re.search(r'step\s+(\d+)/(\d+)\s+loss\s+([\d.e+-]+)', line)
            if epoch:
                epochs.append({'epoch': int(epoch[1]), 'last_batch_train_loss': float(epoch[3]), 'validation_loss': float(epoch[4]), 'elapsed_seconds': time.monotonic() - started})
                write_csv(destination / 'epochs.csv', epochs)
            if step:
                steps.append({'global_step': int(step[1]), 'total_steps': int(step[2]), 'last_batch_train_loss': float(step[3]), 'elapsed_seconds': time.monotonic() - started})
                write_csv(destination / 'steps.csv', steps)
        code = process.wait()
    if code:
        raise RuntimeError('Official command failed: ' + str(code))
    return epochs, time.monotonic() - started


def write_csv(path, values):
    if values:
        with path.open('w') as handle:
            writer = csv.DictWriter(handle, fieldnames=list(values[0]))
            writer.writeheader()
            writer.writerows(values)


def train(directory, index):
    import jax
    import numpy as np
    from needle.model import finetune
    from needle.model.checkpoints import write_adapter
    from needle.model.run import load_checkpoint

    plan = load_plan(directory)
    setting = plan['runs'][index]
    checkpoint = Path(plan['checkpoint']['path'])
    if not os.environ.get('SLURM_JOB_ID') or jax.default_backend() != 'gpu':
        raise RuntimeError('Official training requires a Sol GPU allocation')
    if digest(checkpoint) != plan['checkpoint']['sha256'] or digest(inspect.getfile(finetune)) != plan['officialTrainerSourceSha256'] or importlib.metadata.version('cactus-needle') != '3.1.2':
        raise RuntimeError('Official trainer or checkpoint changed')
    destination = directory / setting['label']
    destination.mkdir(exist_ok=True)
    record_path = destination / 'run.json'
    if record_path.exists():
        prior = json.loads(record_path.read_text())
        if prior.get('status') == 'complete':
            if digest(destination / 'adapter.safetensors') != prior['adapterSha256'] or archive_audit(destination / 'candidate.cact') != prior['archiveAudit']:
                raise RuntimeError('Completed model changed')
            return
    config = plan['training']
    record = {**setting, 'status': 'running', 'slurmJobId': os.environ['SLURM_JOB_ID'], 'host': socket.gethostname(), 'trainerSourceSha256': plan['officialTrainerSourceSha256'], 'wrapperSha256': digest(Path(__file__)), 'checkpointSha256': digest(checkpoint), 'studyPlanSha256': digest(directory / 'study-plan.json'), 'packages': {name: importlib.metadata.version(name) for name in ['cactus-needle', 'jax', 'jaxlib', 'numpy', 'optax', 'flax', 'safetensors']}, 'commands': []}
    save(record_path, record)
    (destination / 'nvidia-smi.txt').write_text(subprocess.check_output(['nvidia-smi'], text=True))
    try:
        if setting['size'] == 0:
            params, _ = load_checkpoint(str(checkpoint))
            adapter = finetune.init_lora(params, finetune.lora_target_paths(params), config['loraRank'], jax.random.PRNGKey(setting['seed']))
            if any(np.count_nonzero(np.asarray(value['B'])) for value in adapter.values()):
                raise RuntimeError('Untuned adapter must have exactly zero update matrices')
            write_adapter(str(destination / 'adapter.safetensors'), {'lora': {'/'.join(key): {name: np.asarray(value) for name, value in matrices.items()} for key, matrices in adapter.items()}, 'scale': config['loraAlpha'] / config['loraRank'], 'base': str(checkpoint), 'rank': config['loraRank'], 'seed': setting['seed']})
            record.update({'optimizerSteps': 0, 'zeroUpdateVerified': True, 'trainingSeconds': 0})
        else:
            training = rows(directory / f'train-{setting["size"]}.jsonl')
            validation = rows(directory / 'validation.jsonl')
            permutation = finetune._training_rng(setting['seed']).permutation(len(training) + len(validation))
            arranged = [None] * len(permutation)
            for position, example in zip(permutation, validation + training):
                arranged[int(position)] = example
            if [arranged[int(i)] for i in permutation[:len(validation)]] != validation or [arranged[int(i)] for i in permutation[len(validation):]] != training:
                raise RuntimeError('Official split is not identical to the frozen split')
            fraction = math.nextafter(len(validation) / len(arranged), math.inf)
            if int(len(arranged) * fraction) != len(validation):
                raise RuntimeError('Incorrect validation size')
            input_path = destination / 'official-input.jsonl'
            input_path.write_text(''.join(json.dumps(example, ensure_ascii=False) + '\n' for example in arranged))
            tokenizer = finetune.get_tokenizer(8192)
            lengths = [sum(len(tokenizer.encode(text)) for text in finetune.render_example(example)) + 2 for example in arranged]
            if max(lengths) > config['maxLength']:
                raise RuntimeError('Training evidence would be truncated')
            padded = finetune.fit_max_len(str(input_path), tokenizer, config['maxLength'])
            if padded != plan['expectedPaddedLength']:
                raise RuntimeError('Training shapes must match across all sample counts')
            if math.ceil(len(training) / config['batchSize']) * setting['epochs'] != setting['updates']:
                raise RuntimeError('Optimizer update budget is not matched')
            command = ['needle', 'finetune', str(input_path), '--checkpoint', str(checkpoint), '--epochs', str(setting['epochs']), '--batch-size', str(config['batchSize']), '--lr', str(config['learningRate']), '--lora-rank', str(config['loraRank']), '--lora-alpha', str(config['loraAlpha']), '--max-len', str(config['maxLength']), '--val-split', repr(fraction), '--seed', str(setting['seed']), '--checkpoint-dir', str(destination), '--out', str(destination / 'adapter.safetensors')]
            record.update({'trainCount': len(training), 'validationCount': len(validation), 'maximumTokenLength': max(lengths), 'paddedLength': padded, 'inputSha256': digest(input_path), 'splitVerification': {'validationIndices': [int(i) for i in permutation[:len(validation)]], 'trainingIndices': [int(i) for i in permutation[len(validation):]], 'trainingSourceSha256': plan['hashes'][f'train-{setting["size"]}.jsonl'], 'validationSourceSha256': plan['hashes']['validation.jsonl']}})
            record['commands'].append(command)
            save(record_path, record)
            epochs, seconds = command_log(command, destination)
            text = (destination / 'training.log').read_text()
            accuracy = re.search(r'accuracy\s+(\d+)/(\d+)', text)
            schedule = re.search(r'schedule\s+(\d+) steps\s+warmup\s+(\d+)', text)
            final_step = re.search(rf'step\s+{setting["updates"]}/{setting["updates"]}\s+loss', text)
            if len(epochs) != setting['epochs'] or not all(math.isfinite(epoch['validation_loss']) for epoch in epochs) or not re.search(r'backend\s+gpu', text) or not accuracy or int(accuracy[2]) != len(validation) or not schedule or int(schedule[1]) != setting['updates'] or not final_step:
                raise RuntimeError('Incomplete official training evidence')
            record.update({'trainingSeconds': seconds, 'optimizerSteps': setting['updates'], 'warmupSteps': int(schedule[2]), 'examplesProcessed': setting['size'] * setting['epochs'], 'officialValidationCorrect': int(accuracy[1]), 'finalValidationLoss': epochs[-1]['validation_loss'], 'minimumValidationLoss': min(epoch['validation_loss'] for epoch in epochs)})
        build = ['needle', 'build', str(checkpoint), '--lora', str(destination / 'adapter.safetensors'), '--layers', '20', '--out', str(destination / 'candidate.cact')]
        record['commands'].append(build)
        save(record_path, record)
        _, build_seconds = command_log(build, destination)
        audit = archive_audit(destination / 'candidate.cact')
        if audit['tokenizerSha256'] != plan['expectedTokenizerSha256']:
            raise RuntimeError('Exported tokenizer changed')
        if setting['size'] == 0 and audit['weightsSha256'] != plan['expectedUntunedExportSha256']:
            raise RuntimeError('Untuned export differs from the fixed 4-bit baseline')
        record.update({'status': 'complete', 'buildSeconds': build_seconds, 'archiveAudit': audit, 'adapterSha256': digest(destination / 'adapter.safetensors'), 'finishedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
    except BaseException as error:
        record.update({'status': 'failed', 'error': str(error)})
        raise
    finally:
        save(record_path, record)


def evaluate(directory, index, limit=None):
    plan = load_plan(directory)
    setting = plan['runs'][index]
    destination = directory / setting['label']
    record = json.loads((destination / 'run.json').read_text())
    if record['status'] != 'complete' or archive_audit(destination / 'candidate.cact') != record['archiveAudit']:
        raise RuntimeError('Evaluation requires a complete, unchanged, audited 4-bit export')
    runtime = plan['evaluation']
    runner = directory / 'runtime/needle'
    container = Path(runtime['container'])
    if digest(runner) != runtime['runnerSha256'] or digest(container) != runtime['containerSha256']:
        raise RuntimeError('Evaluation engine or compatibility container changed')
    result_path = destination / ('preflight-evaluation.json' if limit else 'evaluation.json')
    evidence = {**setting, 'status': 'running', 'slurmJobId': os.environ.get('SLURM_JOB_ID'), 'host': socket.gethostname(), 'studyPlanSha256': digest(directory / 'study-plan.json'), 'runnerSha256': digest(runner), 'archiveAudit': record['archiveAudit'], 'runtime': runtime, 'rows': []}
    save(result_path, evidence)
    with tempfile.TemporaryDirectory(prefix='needle-4bit-') as temporary:
        local = Path(temporary)
        local_runner, local_weights = local / 'needle', local / 'candidate.cact'
        shutil.copyfile(runner, local_runner)
        local_runner.chmod(0o700)
        shutil.copyfile(destination / 'candidate.cact', local_weights)
        if digest(local_weights) != record['archiveAudit']['weightsSha256']:
            raise RuntimeError('Local weight copy changed')
        try:
            for split in ['validation', 'heldOut']:
                examples = rows(directory / f'{split}-requests.jsonl')
                for example in examples[:limit] if limit else examples:
                    tools = local / 'tools.json'
                    tools.write_text(json.dumps(example['tools']))
                    command = ['/usr/bin/apptainer', 'exec', '--bind', f'{local}:{local}', str(container), str(local_runner), '--model', str(local_weights), '--tools', str(tools), '--prompt', example['query'], '--max', str(runtime['maxTokens']), '--threads', str(runtime['threads']), '--fail-input-overflow']
                    started = time.monotonic()
                    response, failure = None, None
                    try:
                        result = subprocess.run(command, capture_output=True, text=True, timeout=runtime['caseTimeoutSeconds'], env={**os.environ, 'NEEDLE_TELEMETRY': '0', 'DO_NOT_TRACK': '1', 'HF_HUB_OFFLINE': '1'})
                        if result.returncode:
                            raise RuntimeError(f'Engine exit {result.returncode}: {result.stderr[-2000:]}')
                        response = json.loads(result.stdout)
                        if response.get('success') is False:
                            raise RuntimeError(response.get('error') or 'Official engine failed')
                    except Exception as error:
                        failure = str(error)
                    calls = response.get('function_calls', []) + response.get('suppressed_calls', []) if response else []
                    mapping = {'allow_call': 'allow', 'block_call': 'disallow', 'ask_owner': 'ask'}
                    verdict = next((mapping[call['name']] for call in calls if call.get('name') in mapping), None)
                    evidence['rows'].append({key: example[key] for key in ['id', 'family', 'topic', 'tool', 'category', 'preference', 'expected', 'inputHash', 'actionHash', 'queryHash']} | {'split': split, 'observed': verdict, 'latencySeconds': time.monotonic() - started, 'infrastructureError': failure, 'response': response})
                    if len(evidence['rows']) % 10 == 0 or failure:
                        save(result_path, evidence)
                        print(f'{setting["label"]}: {len(evidence["rows"])} cases, failure={failure}', flush=True)
                    if failure:
                        raise RuntimeError('Infrastructure failure invalidates this repetition; inspect saved evidence')
            evidence['status'] = 'complete'
        except BaseException as error:
            evidence.update({'status': 'failed', 'error': str(error)})
            raise
        finally:
            evidence['finishedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            save(result_path, evidence)
            flat = [{key: value for key, value in row.items() if key != 'response'} for row in evidence['rows']]
            write_csv(destination / ('preflight-decisions.csv' if limit else 'decisions.csv'), flat)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['train', 'evaluate'])
    parser.add_argument('directory', type=Path)
    parser.add_argument('--index', type=int)
    parser.add_argument('--limit', type=int)
    args = parser.parse_args()
    index = args.index if args.index is not None else int(os.environ['SLURM_ARRAY_TASK_ID'])
    directory = args.directory.resolve()
    if args.mode == 'train':
        train(directory, index)
    else:
        evaluate(directory, index, args.limit)
