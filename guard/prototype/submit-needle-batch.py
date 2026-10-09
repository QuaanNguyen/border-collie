import argparse
import json
from pathlib import Path
import shlex
import subprocess


def submit(directory, existing_array=None):
    plan = json.loads((directory / 'official-plan.json').read_text())
    common = ['sbatch', '--parsable', '--account=grp_dmunnerl', '--partition=public', '--chdir=' + str(directory)]
    setup = 'set -euo pipefail; module load mamba/latest; source activate needle; export NEEDLE_TELEMETRY=0 DO_NOT_TRACK=1 PYTHONUNBUFFERED=1; '
    training = setup + 'python -u needle-batch-task.py ' + shlex.quote(str(directory))
    training_command = common + ['--job-name=judge-needle-ladder', '--gres=gpu:a100:1', '--mem=32G', '--cpus-per-task=8', '--time=02:00:00', f'--array=0-{len(plan["runs"]) - 1}%2', '--output=batch-%A_%a.out', '--wrap=bash -lc ' + shlex.quote(training)]
    prior_submission = None
    if existing_array:
        prior_submission = json.loads((directory / 'batch-submission.json').read_text())
        if prior_submission['trainingArrayId'] != existing_array:
            raise RuntimeError('Existing array does not match this experiment')
        array_id = existing_array
    else:
        array_id = subprocess.check_output(training_command, text=True).strip().split(';')[0]
    evaluation = setup + 'export PATH=' + shlex.quote(str(directory / 'runtime/node/bin')) + ':$PATH; export BORDER_COLLIE_JUDGE_ROOT=' + shlex.quote(str(directory / 'judge-root')) + '; python -u collect-needle-batch.py ' + shlex.quote(str(directory))
    evaluation_command = common + ['--job-name=judge-needle-evaluate', '--dependency=afterany:' + array_id, '--mem=8G', '--cpus-per-task=4', '--time=04:00:00', '--output=evaluation-%j.out', '--wrap=bash -lc ' + shlex.quote(evaluation)]
    try:
        evaluation_id = subprocess.check_output(evaluation_command, text=True).strip().split(';')[0]
    except BaseException:
        (directory / 'batch-submission.json').write_text(json.dumps({'trainingArrayId': array_id, 'trainingCommand': training_command, 'evaluationSubmission': 'failed'}, indent=2) + '\n')
        raise
    record = {'trainingArrayId': array_id, 'evaluationJobId': evaluation_id, 'trainingCommand': training_command, 'evaluationCommand': evaluation_command, 'tasks': [{**setting, 'taskId': f'{array_id}_{index}'} for index, setting in enumerate(plan['runs'])], 'concurrentTrainingTasks': 2, 'resume': 'Completed adapters and exports are hash-verified and skipped. Incomplete settings restart through the official CLI.'}
    if prior_submission:
        record['supersededEvaluationJobId'] = prior_submission['evaluationJobId']
        subprocess.run(['scancel', prior_submission['evaluationJobId']], check=True)
    (directory / 'batch-submission.json').write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps(record, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    parser.add_argument('--existing-array')
    args = parser.parse_args()
    submit(args.directory.resolve(), args.existing_array)
