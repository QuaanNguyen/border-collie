import argparse
import hashlib
import json
from pathlib import Path
import shlex
import subprocess


def submit(directory, preflight_dependency=None):
    path = directory / 'submission.json'
    if path.exists():
        raise RuntimeError('Study already submitted; inspect its recorded jobs instead of duplicating them')
    plan = json.loads((directory / 'study-plan.json').read_text())
    if len(plan['runs']) != 80 or plan['seeds'] != list(range(10)) or plan['sizes'] != [0, 100, 300, 600, 1000, 2000] or plan['training']['quantizedWeightBits'] != 4:
        raise RuntimeError('Unexpected study design')
    common = ['sbatch', '--parsable', '--account=grp_dmunnerl', '--partition=public', '--chdir=' + str(directory), '--kill-on-invalid-dep=yes']
    setup = 'set -euo pipefail; export PATH=/home/qnguye19/.conda/envs/needle/bin:$PATH; export NEEDLE_TELEMETRY=0 DO_NOT_TRACK=1 PYTHONUNBUFFERED=1 XLA_PYTHON_CLIENT_PREALLOCATE=false; '
    wrapper = '/home/qnguye19/.conda/envs/needle/bin/python -u needle-4bit-study.py '
    commands = {}
    record = {'studyPlanSha256': hashlib.sha256((directory / 'study-plan.json').read_bytes()).hexdigest(), 'tasks': [{**setting, 'index': index} for index, setting in enumerate(plan['runs'])], 'commands': commands, 'status': 'submitting', 'concurrentTrainingTasks': 2, 'concurrentEvaluationTasks': 8, 'additionalPreflightDependency': preflight_dependency}
    path.write_text(json.dumps(record, indent=2) + '\n')

    def queue(name, options, command):
        invocation = common + ['--job-name=' + name] + options + ['--wrap=bash -lc ' + shlex.quote(setup + command)]
        commands[name] = invocation
        path.write_text(json.dumps(record, indent=2) + '\n')
        identifier = subprocess.check_output(invocation, text=True).strip().split(';')[0]
        record[name] = identifier
        path.write_text(json.dumps(record, indent=2) + '\n')
        return identifier

    try:
        baseline = queue('needle-4bit-preflight-build', ['--gres=gpu:a100:1', '--mem=32G', '--cpus-per-task=8', '--time=00:20:00', '--output=preflight-build-%j.out'], wrapper + 'train ' + shlex.quote(str(directory)) + ' --index 0')
        dependency = baseline + (':' + preflight_dependency if preflight_dependency else '')
        limit = 10 if preflight_dependency else 100
        preflight = queue('needle-4bit-preflight-eval', ['--dependency=afterok:' + dependency, '--mem=8G', '--cpus-per-task=4', '--time=01:00:00', '--output=preflight-eval-%j.out'], wrapper + 'evaluate ' + shlex.quote(str(directory)) + ' --index 0 --limit ' + str(limit))
        training = queue('needle-4bit-train', ['--dependency=afterok:' + preflight, '--gres=gpu:a100:1', '--mem=32G', '--cpus-per-task=8', '--time=02:00:00', '--array=0-79%2', '--output=train-%A_%a.out'], wrapper + 'train ' + shlex.quote(str(directory)))
        evaluation = queue('needle-4bit-evaluate', ['--dependency=aftercorr:' + training, '--mem=8G', '--cpus-per-task=4', '--time=04:00:00', '--array=0-79%8', '--output=evaluate-%A_%a.out'], wrapper + 'evaluate ' + shlex.quote(str(directory)))
        plotting = 'export PYTHONPATH=/scratch/qnguye19/needle/experiments/needle-official-ladder/runtime/plotting; export MPLCONFIGDIR=' + shlex.quote(str(directory / 'runtime/matplotlib-cache')) + '; /home/qnguye19/.conda/envs/needle/bin/python -u summarize-needle-4bit-study.py ' + shlex.quote(str(directory))
        queue('needle-4bit-summary', ['--dependency=afterany:' + training + ':' + evaluation, '--mem=8G', '--cpus-per-task=2', '--time=00:30:00', '--output=summary-%j.out'], plotting)
        record['status'] = 'submitted'
    except BaseException as error:
        record.update({'status': 'submission-failed', 'error': str(error)})
        raise
    finally:
        path.write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps({key: value for key, value in record.items() if key not in ['commands', 'tasks']}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    parser.add_argument('--preflight-dependency')
    args = parser.parse_args()
    submit(args.directory.resolve(), args.preflight_dependency)
