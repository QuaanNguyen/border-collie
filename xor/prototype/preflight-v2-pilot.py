import argparse
import hashlib
import inspect
import json
import os
from pathlib import Path
import statistics
import time


def preflight(directory):
    from needle.model import finetune

    source = directory / 'requests.jsonl'
    records = [json.loads(line) for line in source.read_text().splitlines() if line.strip()]
    tokenizer = finetune.get_tokenizer(8192)
    lengths = []
    for record in records:
        example = {key: record[key] for key in ['query', 'tools']}
        example['answers'] = [{'name': 'allow_call', 'arguments': {}}]
        prompt, target = finetune.render_example(example)
        if 'think' in target:
            raise RuntimeError('An answers-only target contains reasoning markers')
        lengths.append(len(tokenizer.encode(prompt)) + len(tokenizer.encode(target)) + 2)
    result = {
        'status': 'complete' if max(lengths) <= 1024 else 'overflow',
        'jobId': os.environ.get('SLURM_JOB_ID'),
        'cases': len(records),
        'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'trainerSourceSha256': hashlib.sha256(Path(inspect.getfile(finetune)).read_bytes()).hexdigest(),
        'maximumTokens': max(lengths),
        'medianTokens': statistics.median(lengths),
        'overflowIds': [record['id'] for record, length in zip(records, lengths) if length > 1024],
        'answersOnlyHasReasoningMarkers': False,
        'finishedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'limitation': 'Checks official training rendering and complete inputs; native runner behavior is a separate measurement.',
    }
    (directory / 'preflight.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: value for key, value in result.items() if key != 'overflowIds'}))
    if result['status'] != 'complete':
        raise RuntimeError('Complete inputs do not fit; exclude and re-review affected families before training')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    preflight(parser.parse_args().directory.resolve())
