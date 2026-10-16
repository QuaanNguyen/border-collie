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
import socket
import subprocess
import time

os.environ['NEEDLE_TELEMETRY'] = '0'
os.environ['DO_NOT_TRACK'] = '1'


def digest(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def save(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def read_rows(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def arrange_rows(train, validation, permutation):
    if len(permutation) != len(train) + len(validation) or sorted(permutation) != list(range(len(permutation))):
        raise ValueError('Permutation does not cover the dataset exactly')
    rows = [None] * len(permutation)
    for position, row in zip(permutation, validation + train):
        rows[int(position)] = row
    if [rows[int(index)] for index in permutation[:len(validation)]] != validation:
        raise ValueError('Official split does not reproduce the frozen validation set')
    if [rows[int(index)] for index in permutation[len(validation):]] != train:
        raise ValueError('Official split does not reproduce the frozen training set')
    return rows


def command_log(command, destination, label, epochs_path=None, steps_path=None):
    started = time.monotonic()
    epoch_rows, step_rows = [], []
    with destination.open('w') as handle:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        for line in process.stdout:
            handle.write(line)
            handle.flush()
            print(f'[{label}] {line.rstrip()}', flush=True)
            epoch = re.search(r'epoch\s+(\d+)/(\d+)\s+loss\s+([\d.e+-]+)\s+val\s+([\d.e+-]+)', line)
            step = re.search(r'step\s+(\d+)/(\d+)\s+loss\s+([\d.e+-]+)', line)
            if epoch:
                epoch_rows.append({'epoch': int(epoch[1]), 'last_batch_train_loss': float(epoch[3]), 'validation_loss': float(epoch[4]), 'elapsed_seconds': time.monotonic() - started})
            if step:
                step_rows.append({'global_step': int(step[1]), 'total_steps': int(step[2]), 'train_loss': float(step[3]), 'elapsed_seconds': time.monotonic() - started})
            for file, rows in [(epochs_path, epoch_rows), (steps_path, step_rows)]:
                if file and rows:
                    with file.open('w') as output:
                        writer = csv.DictWriter(output, fieldnames=rows[0].keys())
                        writer.writeheader()
                        writer.writerows(rows)
        code = process.wait()
    if code:
        raise RuntimeError(f'Official command failed with exit {code}: {command}')
    return epoch_rows, time.monotonic() - started


def run(directory, label_filter=None):
    import numpy as np
    from needle.model import finetune
    from needle.model.checkpoints import read_adapter, write_adapter
    from safetensors import safe_open

    plan = json.loads((directory / 'official-plan.json').read_text())
    checkpoint = Path(plan['training']['checkpoint'])
    if not os.environ.get('SLURM_JOB_ID'):
        raise RuntimeError('A Slurm GPU allocation is required')
    if digest(checkpoint) != plan['priorCustomRun']['checkpointSha256']:
        raise RuntimeError('Base checkpoint changed')
    if digest(Path(inspect.getfile(finetune))) != plan['priorCustomRun']['needleTrainerSourceSha256']:
        raise RuntimeError('Official trainer source changed; inspect its split before running')
    for name, expected in plan['hashes'].items():
        if digest(directory / name) != expected:
            raise RuntimeError('Frozen data changed: ' + name)
    for name in ['JAX_COMPILATION_CACHE_DIR', 'JAX_PERSISTENT_CACHE_MIN_COMPILE_TIME_SECS', 'JAX_PERSISTENT_CACHE_MIN_ENTRY_SIZE_BYTES']:
        os.environ.pop(name, None)
    settings = [setting for setting in plan['runs'] if label_filter is None or setting['label'] == label_filter]
    if not settings:
        raise ValueError('Unknown experiment label')
    state_path = directory / (f'job-{label_filter}.json' if label_filter else 'job.json')
    state = json.loads(state_path.read_text()) if state_path.exists() else {
        'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'slurmJobId': os.environ['SLURM_JOB_ID'], 'host': socket.gethostname(),
        'sourceSha256': digest(Path(__file__)), 'officialTrainerSourceSha256': digest(Path(inspect.getfile(finetune))),
        'packages': {name: importlib.metadata.version(name) for name in ['cactus-needle', 'numpy', 'jax', 'jaxlib', 'flax', 'optax', 'safetensors']},
        'runs': {},
        'metricDefinition': 'Unmodified official CLI: epoch training loss is its last batch; validation loss averages its validation batches. Official exact-call validation accuracy uses its JAX quantized generator. Native runtime decisions are measured separately.',
    }
    state['status'] = 'running'
    state['slurmJobId'] = os.environ['SLURM_JOB_ID']
    state['host'] = socket.gethostname()
    state['sourceSha256'] = digest(Path(__file__))
    save(state_path, state)
    evidence_directory = directory / label_filter if label_filter else directory
    evidence_directory.mkdir(exist_ok=True)
    (evidence_directory / 'nvidia-smi.txt').write_text(subprocess.check_output(['nvidia-smi'], text=True))
    (evidence_directory / 'packages.txt').write_text(subprocess.check_output(['python', '-m', 'pip', 'freeze'], text=True))
    with safe_open(str(checkpoint), framework='np') as handle:
        metadata = handle.metadata()
    config = json.loads(metadata['config'])
    tokenizer = finetune.get_tokenizer(config['vocab_size'])
    control = directory / 'base-local-export'
    if not (control / 'candidate.cact').exists():
        control.mkdir(exist_ok=True)
        adapter = read_adapter(str(directory / 'best.safetensors'))
        for value in adapter['lora'].values():
            value['B'] = np.zeros_like(value['B'])
        write_adapter(str(control / 'zero.safetensors'), adapter)
        command = ['needle', 'build', str(checkpoint), '--lora', str(control / 'zero.safetensors'), '--layers', str(plan['training']['exportLayers']), '--out', str(control / 'candidate.cact')]
        command_log(command, control / 'build.log', 'base-local-export')
        save(control / 'run.json', {'status': 'complete', 'control': 'All adapter B matrices are exactly zero, so merging leaves base checkpoint weights unchanged; official build applies the same 4-bit export and confidence-head removal as tuned models.', 'command': command, 'candidateSha256': digest(control / 'candidate.cact'), 'checkpointSha256': digest(checkpoint)})
    for setting in settings:
        label, size, seed = setting['label'], setting['size'], setting['seed']
        destination = directory / label
        destination.mkdir(exist_ok=True)
        saved_record = destination / 'run.json'
        if saved_record.exists():
            saved = json.loads(saved_record.read_text())
            if saved.get('status') == 'complete':
                if digest(destination / 'candidate.cact') != saved['candidateSha256'] or digest(destination / 'adapter.safetensors') != saved['adapterSha256']:
                    raise RuntimeError('Completed artifacts changed: ' + label)
                state['runs'][label] = saved
                save(state_path, state)
                continue
        suffix = '-reasoning' if setting['reasoning'] else ''
        train = read_rows(directory / f'train-{size}{suffix}.jsonl')
        validation = read_rows(directory / f'validation{suffix}.jsonl')
        permutation = finetune._training_rng(seed).permutation(len(train) + len(validation))
        rows = arrange_rows(train, validation, permutation)
        split = math.nextafter(len(validation) / len(rows), math.inf)
        if int(len(rows) * split) != len(validation):
            raise RuntimeError('Validation fraction rounds to the wrong case count')
        lengths = []
        for row in rows:
            prompt, target = finetune.render_example(row)
            lengths.append(len(tokenizer.encode(prompt)) + len(tokenizer.encode(target)) + 2)
        if max(lengths) > plan['training']['maxLength']:
            raise RuntimeError(f'{label} would truncate training evidence: {max(lengths)} tokens')
        inputs = destination / 'official-input.jsonl'
        inputs.write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows))
        commands = [
            ['needle', 'finetune', str(inputs), '--checkpoint', str(checkpoint), '--epochs', str(plan['training']['epochs']), '--batch-size', str(plan['training']['batchSize']), '--lr', str(plan['training']['learningRate']), '--lora-rank', str(plan['training']['loraRank']), '--lora-alpha', str(plan['training']['loraAlpha']), '--max-len', str(plan['training']['maxLength']), '--val-split', repr(split), '--seed', str(seed), '--checkpoint-dir', str(destination), '--out', str(destination / 'adapter.safetensors')],
            ['needle', 'build', str(checkpoint), '--lora', str(destination / 'adapter.safetensors'), '--layers', str(plan['training']['exportLayers']), '--out', str(destination / 'candidate.cact')],
        ]
        run_record = {**setting, 'status': 'running', 'slurmJobId': os.environ['SLURM_JOB_ID'], 'host': socket.gethostname(), 'orchestratorSourceSha256': digest(Path(__file__)), 'trainCount': len(train), 'validationCount': len(validation), 'validationSplit': split, 'inputSha256': digest(inputs), 'maximumTokenLength': max(lengths), 'commands': commands, 'splitVerification': {'validationIndices': [int(index) for index in permutation[:len(validation)]], 'trainingIndices': [int(index) for index in permutation[len(validation):]], 'trainingSourceSha256': plan['hashes'][f'train-{size}{suffix}.jsonl'], 'validationSourceSha256': plan['hashes'][f'validation{suffix}.jsonl']}}
        state['runs'][label] = run_record
        save(state_path, state)
        try:
            epochs, training_seconds = command_log(commands[0], destination / 'training.log', label, destination / 'epochs.csv', destination / 'steps.csv')
            if len(epochs) != plan['training']['epochs'] or not all(math.isfinite(row['validation_loss']) for row in epochs):
                raise RuntimeError('Missing epochs or invalid official validation losses')
            text = (destination / 'training.log').read_text()
            if not re.search(r'backend\s+gpu', text):
                raise RuntimeError('Official trainer did not use the GPU')
            accuracy = re.search(r'accuracy\s+(\d+)/(\d+)', text)
            if not accuracy or int(accuracy[2]) != len(validation):
                raise RuntimeError('Official CLI did not score exactly the frozen validation cases')
            _, build_seconds = command_log(commands[1], destination / 'build.log', label + '-build')
            run_record.update({'status': 'complete', 'trainingSeconds': training_seconds, 'buildSeconds': build_seconds, 'officialValidationExactCalls': {'correct': int(accuracy[1]), 'total': int(accuracy[2])}, 'finalValidationLoss': epochs[-1]['validation_loss'], 'minimumValidationLoss': min(row['validation_loss'] for row in epochs), 'candidateSha256': digest(destination / 'candidate.cact'), 'adapterSha256': digest(destination / 'adapter.safetensors')})
            save(destination / 'run.json', run_record)
            save(state_path, state)
        except BaseException as error:
            run_record.update({'status': 'failed', 'error': str(error)})
            save(destination / 'run.json', run_record)
            save(state_path, state)
            raise
    state.update({'status': 'complete', 'finishedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
    save(state_path, state)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    parser.add_argument('--label')
    args = parser.parse_args()
    run(args.directory.resolve(), args.label)
