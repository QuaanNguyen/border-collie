import argparse
import csv
import hashlib
import importlib.metadata
import inspect
import json
import math
import os
from pathlib import Path
import platform
import shutil
import socket
import subprocess
import time

os.environ['NEEDLE_TELEMETRY'] = '0'
os.environ['DO_NOT_TRACK'] = '1'


def sha256(path):
    with open(path, 'rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def train(directory, checkpoint):
    import jax
    import jax.numpy as jnp
    import numpy as np
    import optax
    from needle.model import finetune
    from needle.model.architecture import SimpleAttentionNetwork
    from needle.model.checkpoints import write_adapter
    from needle.model.quantize import configure_deploy, cq_ste_params, WEIGHT_BITS
    from needle.model.run import load_checkpoint

    experiment = json.loads((directory / 'experiment.json').read_text())
    settings = experiment['training']
    if not os.environ.get('SLURM_JOB_ID') or jax.default_backend() != 'gpu':
        raise RuntimeError('Training requires a Sol Slurm GPU allocation')
    if (directory / 'run.json').exists():
        raise RuntimeError('Run already started; choose a new experiment directory')
    for name, expected in experiment['hashes'].items():
        if sha256(directory / name) != expected:
            raise RuntimeError('Frozen data hash mismatch: ' + name)
    started = time.monotonic()
    run = {
        'status': 'running', 'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'seed': experiment['seed'], 'settings': settings, 'dataHashes': experiment['hashes'],
        'requestFormatVersion': experiment['requestFormatVersion'],
        'slurmJobId': os.environ['SLURM_JOB_ID'], 'host': socket.gethostname(),
        'python': platform.python_version(), 'checkpoint': str(checkpoint),
        'checkpointSha256': sha256(checkpoint),
        'packages': {name: importlib.metadata.version(name) for name in ['cactus-needle', 'jax', 'jaxlib', 'optax', 'flax', 'numpy', 'safetensors']},
        'trainerSourceSha256': sha256(Path(__file__)),
        'needleTrainerSourceSha256': sha256(Path(inspect.getfile(finetune))),
        'devices': [str(device) for device in jax.devices()],
        'metricDefinition': 'Token-weighted answer cross-entropy under Needle CQ quantization-aware training. Epoch losses evaluate the whole split using the same adapter. Step loss is measured before that update.',
    }
    write_json(directory / 'run.json', run)
    (directory / 'nvidia-smi.txt').write_text(subprocess.check_output(['nvidia-smi'], text=True))
    (directory / 'packages.txt').write_text(subprocess.check_output(['python', '-m', 'pip', 'freeze'], text=True))
    params, config = load_checkpoint(str(checkpoint))
    config.dtype = 'float32'
    params = jax.device_put(jax.tree.map(lambda value: np.asarray(value).astype(np.float32), params))
    tokenizer = finetune.get_tokenizer(config.vocab_size)
    datasets = {}
    lengths = []
    for split in ['train', 'validation']:
        examples = list(finetune.read_examples(str(directory / (split + '.jsonl'))))
        for example in examples:
            prompt, target = finetune.render_example(example)
            lengths.append(len(tokenizer.encode(prompt)) + len(tokenizer.encode(target)) + 2)
        expected = experiment['distributions'][split]['count']
        if len(examples) != expected:
            raise RuntimeError('Incorrect sample count for ' + split)
    max_length = settings['maxLength']
    if max(lengths) > max_length:
        raise RuntimeError(f'Sequence truncation would discard training evidence: {max(lengths)} > {max_length}')
    for split in ['train', 'validation']:
        datasets[split] = finetune.load_jsonl(str(directory / (split + '.jsonl')), tokenizer, max_length)
    run['tokenLengths'] = {'minimum': min(lengths), 'maximum': max(lengths), 'p50': float(np.median(lengths)), 'p95': float(np.percentile(lengths, 95)), 'paddedLength': max_length}
    run['layers'] = config.num_layers
    configure_deploy(act_bits=getattr(config, 'act_bits', 8), kv_bits=getattr(config, 'kv_bits', 8))
    model = SimpleAttentionNetwork(config)
    paths = finetune.lora_target_paths(params)
    seed = experiment['seed']
    rng = np.random.default_rng(seed)
    scale = settings['loraAlpha'] / settings['loraRank']
    lora = finetune.init_lora(params, paths, settings['loraRank'], jax.random.PRNGKey(seed))
    batch = settings['batchSize']
    count = len(datasets['train'][0])
    steps_per_epoch = math.ceil(count / batch)
    total_steps = settings['epochs'] * steps_per_epoch
    warmup = min(max(1, total_steps // 20), total_steps - 1)
    schedule = optax.warmup_cosine_decay_schedule(init_value=0.0, peak_value=settings['learningRate'], warmup_steps=warmup, decay_steps=total_steps)
    optimizer = optax.chain(optax.clip_by_global_norm(settings['gradientClipNorm']), optax.adamw(schedule, weight_decay=settings['weightDecay']))
    opt_state = optimizer.init(lora)
    run.update({'stepsPerEpoch': steps_per_epoch, 'totalSteps': total_steps, 'warmupSteps': warmup, 'weightBits': WEIGHT_BITS})
    write_json(directory / 'run.json', run)

    def loss_fn(adapter, ids, mask):
        merged = cq_ste_params(finetune.merge_lora(params, adapter, scale), WEIGHT_BITS)
        logits = model.apply({'params': merged}, ids, quant=True)[:, :-1]
        targets, target_mask = ids[:, 1:], mask[:, 1:]
        ce = optax.softmax_cross_entropy_with_integer_labels(logits, targets)
        return (ce * target_mask).sum() / jnp.maximum(target_mask.sum(), 1.0)

    @jax.jit
    def train_step(adapter, state, ids, mask):
        loss, grads = jax.value_and_grad(loss_fn)(adapter, ids, mask)
        updates, state = optimizer.update(grads, state, adapter)
        return optax.apply_updates(adapter, updates), state, loss

    eval_step = jax.jit(loss_fn)

    def evaluate(adapter, split):
        seqs, masks = datasets[split]
        weighted_loss, tokens = 0.0, 0
        for start in range(0, len(seqs), batch):
            token_count = float(masks[start:start + batch, 1:].sum())
            value = float(eval_step(adapter, jnp.asarray(seqs[start:start + batch]), jnp.asarray(masks[start:start + batch])))
            weighted_loss += value * token_count
            tokens += token_count
        return weighted_loss / tokens

    def save_adapter(adapter, path):
        write_adapter(str(path), {
            'lora': {'/'.join(key): {'A': np.asarray(value['A']), 'B': np.asarray(value['B'])} for key, value in adapter.items()},
            'scale': float(scale), 'base': str(checkpoint), 'rank': settings['loraRank'], 'seed': seed,
        })

    metric_fields = ['epoch', 'global_step', 'train_samples_seen', 'train_loss', 'validation_loss', 'learning_rate', 'elapsed_seconds', 'epoch_seconds']
    step_fields = ['epoch', 'global_step', 'train_samples_seen', 'batch_samples', 'loss', 'learning_rate', 'elapsed_seconds', 'step_seconds']
    (directory / 'adapters').mkdir()
    best = math.inf
    step, samples_seen = 0, 0
    with (directory / 'epochs.csv').open('w') as epoch_handle, (directory / 'steps.csv').open('w') as step_handle:
        epochs = csv.DictWriter(epoch_handle, fieldnames=metric_fields)
        steps = csv.DictWriter(step_handle, fieldnames=step_fields)
        epochs.writeheader()
        steps.writeheader()
        for epoch in range(settings['epochs'] + 1):
            epoch_start = time.monotonic()
            if epoch:
                seqs, masks = datasets['train']
                order = rng.permutation(count)
                for start in range(0, count, batch):
                    indices = order[start:start + batch]
                    step_start = time.monotonic()
                    lr = float(schedule(step))
                    lora, opt_state, loss = train_step(lora, opt_state, jnp.asarray(seqs[indices]), jnp.asarray(masks[indices]))
                    loss = float(loss)
                    if not math.isfinite(loss):
                        raise RuntimeError('Non-finite training loss')
                    step += 1
                    samples_seen += len(indices)
                    steps.writerow(dict(zip(step_fields, [epoch, step, samples_seen, len(indices), loss, lr, time.monotonic() - started, time.monotonic() - step_start])))
                    step_handle.flush()
            train_loss, val_loss = evaluate(lora, 'train'), evaluate(lora, 'validation')
            if not math.isfinite(train_loss) or not math.isfinite(val_loss):
                raise RuntimeError('Non-finite epoch loss')
            epochs.writerow(dict(zip(metric_fields, [epoch, step, samples_seen, train_loss, val_loss, float(schedule(step)), time.monotonic() - started, time.monotonic() - epoch_start])))
            epoch_handle.flush()
            print(f'Epoch {epoch}/{settings["epochs"]}: train={train_loss:.6f} validation={val_loss:.6f} step={step}/{total_steps}', flush=True)
            if epoch:
                adapter_path = directory / 'adapters' / f'epoch-{epoch:02d}.safetensors'
                save_adapter(lora, adapter_path)
                if val_loss < best:
                    best = val_loss
                    shutil.copyfile(adapter_path, directory / 'best.safetensors')
                    run.update({'bestEpoch': epoch, 'bestValidationLoss': val_loss})
                    write_json(directory / 'run.json', run)
    shutil.copyfile(adapter_path, directory / 'final.safetensors')
    run.update({'status': 'trained', 'trainingSeconds': time.monotonic() - started})
    write_json(directory / 'run.json', run)
    build_environment = {**os.environ, 'XLA_PYTHON_CLIENT_PREALLOCATE': 'false'}
    for label in ['best', 'final']:
        command = ['needle', 'build', str(checkpoint), '--lora', str(directory / (label + '.safetensors')), '--layers', str(settings['exportLayers']), '--out', str(directory / (label + '.cact'))]
        subprocess.run(command, check=True, env=build_environment)
    run.update({'status': 'complete', 'finishedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'totalSeconds': time.monotonic() - started, 'outputHashes': {name: sha256(directory / name) for name in ['best.safetensors', 'final.safetensors', 'best.cact', 'final.cact', 'epochs.csv', 'steps.csv']}})
    write_json(directory / 'run.json', run)
    print(json.dumps(run, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    parser.add_argument('--checkpoint', type=Path, default=Path('/scratch/qnguye19/needle/checkpoints/needle3.safetensors'))
    args = parser.parse_args()
    if (args.directory / 'run.json').exists():
        parser.error('Run already started; choose a new experiment directory')
    try:
        train(args.directory.resolve(), args.checkpoint.resolve())
    except BaseException as error:
        run_path = args.directory / 'run.json'
        if run_path.exists():
            record = json.loads(run_path.read_text())
            record.update({'status': 'failed', 'error': str(error)})
            write_json(run_path, record)
        raise
