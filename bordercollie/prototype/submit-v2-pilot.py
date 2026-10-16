import argparse
import hashlib
import json
from pathlib import Path
import shlex
import subprocess


def submit(directory, token_dependency):
    submission = directory / 'submission.json'
    if submission.exists():
        raise RuntimeError('This pilot already has a submission record; inspect it instead of duplicating jobs')
    plan = json.loads((directory / 'study-plan.json').read_text())
    if plan['status'] != 'frozen-diagnostic-pilot' or len(plan['runs']) != 24 or plan['seeds'] != [0, 1, 2]:
        raise RuntimeError('Unexpected pilot design')
    waves = plan.get('executionWaves', [list(range(len(plan['runs'])))])
    indices = [index for wave in waves for index in wave]
    if not waves or any(not wave for wave in waves) or any(type(index) is not int for index in indices) or sorted(indices) != list(range(len(plan['runs']))):
        raise RuntimeError('Execution waves must cover every condition exactly once')
    for name, expected in {**plan['hashes'], **plan['wrapperHashes']}.items():
        if hashlib.sha256((directory / name).read_bytes()).hexdigest() != expected:
            raise RuntimeError('Frozen input changed: ' + name)
    with Path(plan['baseArchive']['path']).open('rb') as handle:
        if hashlib.file_digest(handle, 'sha256').hexdigest() != plan['baseArchive']['sha256']:
            raise RuntimeError('Pinned base archive changed')
    preflight = json.loads((directory / 'preflight.json').read_text())
    if preflight['status'] != 'complete' or preflight['maximumTokens'] > 1024 or preflight['sourceSha256'] != hashlib.sha256((directory / 'requests.jsonl').read_bytes()).hexdigest():
        raise RuntimeError('Token preflight has not passed')
    common = ['sbatch', '--parsable', '--account=grp_dmunnerl', '--partition=public', '--chdir=' + str(directory), '--kill-on-invalid-dep=yes']
    setup = 'set -euo pipefail; export PATH=/home/qnguye19/.conda/envs/needle/bin:$PATH; export NEEDLE_TELEMETRY=0 DO_NOT_TRACK=1 HF_HUB_OFFLINE=1 PYTHONUNBUFFERED=1 XLA_PYTHON_CLIENT_PREALLOCATE=false; '
    wrapper = '/home/qnguye19/.conda/envs/needle/bin/python -u needle-4bit-study.py '
    record = {'status': 'submitting', 'studyPlanSha256': hashlib.sha256((directory / 'study-plan.json').read_bytes()).hexdigest(), 'tokenPreflightJob': token_dependency, 'jobs': {}, 'commands': {}, 'gpuConcurrency': 2, 'evaluationConcurrency': 4, 'executionWaves': waves}
    submission.write_text(json.dumps(record, indent=2) + '\n')

    def queue(name, options, command):
        invocation = common + ['--job-name=' + name] + options + ['--wrap=bash -lc ' + shlex.quote(setup + command)]
        record['commands'][name] = invocation
        submission.write_text(json.dumps(record, indent=2) + '\n')
        identifier = subprocess.check_output(invocation, text=True).strip().split(';')[0]
        record['jobs'][name] = identifier
        submission.write_text(json.dumps(record, indent=2) + '\n')
        return identifier

    try:
        baseline = queue('v2-pilot-baseline-build', ['--dependency=afterok:' + token_dependency, '--gres=gpu:a100:1', '--mem=32G', '--cpus-per-task=8', '--time=00:30:00', '--output=baseline-%j.out'], wrapper + 'train ' + shlex.quote(str(directory)) + ' --index 0')
        engine = queue('v2-pilot-engine-preflight', ['--dependency=afterok:' + baseline, '--mem=8G', '--cpus-per-task=4', '--time=00:30:00', '--output=engine-preflight-%j.out'], wrapper + 'evaluate ' + shlex.quote(str(directory)) + ' --index 0 --limit 10')
        dependencies = [engine]
        all_arrays = []
        for number, wave in enumerate(waves):
            suffix = '' if number == 0 else '-wave' + str(number + 1)
            tasks = ','.join(str(index) for index in wave)
            training = queue('v2-pilot-fit' + suffix, ['--dependency=afterok:' + ':'.join(dependencies), '--gres=gpu:a100:1', '--mem=32G', '--cpus-per-task=8', '--time=04:00:00', '--array=' + tasks + '%2', '--output=train-%A_%a.out'], wrapper + 'train ' + shlex.quote(str(directory)))
            evaluation = queue('v2-pilot-evaluate' + suffix, ['--dependency=aftercorr:' + training, '--mem=8G', '--cpus-per-task=4', '--time=03:00:00', '--array=' + tasks + '%4', '--output=evaluate-%A_%a.out'], wrapper + 'evaluate ' + shlex.quote(str(directory)))
            dependencies = [training, evaluation]
            all_arrays.extend(dependencies)
        queue('v2-pilot-summary', ['--dependency=afterany:' + ':'.join(all_arrays), '--mem=4G', '--cpus-per-task=2', '--time=00:15:00', '--output=summary-%j.out'], '/home/qnguye19/.conda/envs/needle/bin/python -u summarize-v2-pilot.py ' + shlex.quote(str(directory)))
        record['status'] = 'submitted'
    except BaseException as error:
        record.update({'status': 'submission-failed', 'error': str(error)})
        raise
    finally:
        submission.write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps({key: value for key, value in record.items() if key != 'commands'}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    parser.add_argument('--token-dependency', required=True)
    args = parser.parse_args()
    submit(args.directory.resolve(), args.token_dependency)
