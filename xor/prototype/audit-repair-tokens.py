import argparse
from functools import lru_cache
import hashlib
import importlib.util
import json
from pathlib import Path
import time


def audit(directory, archive):
    root = Path(__file__).resolve().parents[2]
    source = root / 'analysis/needle-judge-2026-10-09/scripts/input-lengths.py'
    spec = importlib.util.spec_from_file_location('captured_needle_tokenizer', source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    definitions = module.load_official_definitions()
    blob = definitions['read_tokenizer_blob'](archive)
    if hashlib.sha256(blob).hexdigest() != '9f839cd44027ea9203738897da2bac572a5cc77aec7fceacd4391fc412a3249f':
        raise RuntimeError('Pinned tokenizer changed')
    tokenizer = definitions['RefTokenizer'](definitions['parse_tokenizer_blob'](blob))
    tokenizer._bpe = lru_cache(maxsize=32768)(tokenizer._bpe)
    file = directory / 'requests.jsonl'
    source_hash = hashlib.sha256(file.read_bytes()).hexdigest()
    result = []
    started = time.monotonic()
    for line in file.read_text().splitlines():
        row = json.loads(line)
        sizes = {}
        for verdict, tool in [('allow', 'allow_call'), ('disallow', 'block_call'), ('ask', 'ask_owner')]:
            prompt, target = definitions['render_example']({**row['input'], 'answers': [{'name': tool, 'arguments': {}}]})
            sizes[verdict] = len(tokenizer.encode(prompt)) + len(tokenizer.encode(target)) + 2
        result.append({'id': row['id'], 'maximumTokens': max(sizes.values()), 'byVerdict': sizes})
        if len(result) % 500 == 0:
            print(json.dumps({'checked': len(result), 'seconds': round(time.monotonic() - started, 2)}), flush=True)
    if hashlib.sha256(file.read_bytes()).hexdigest() != source_hash:
        raise RuntimeError('Requests changed during the token audit')
    lengths = [row['maximumTokens'] for row in result]
    maximum_length = 128
    while maximum_length < max(lengths):
        maximum_length *= 2
    report = {'status': 'complete', 'requestsSha256': source_hash, 'tokenizerSha256': hashlib.sha256(blob).hexdigest(), 'officialSourceRevision': module.REVISION, 'allThreeVerdictTargetsChecked': True, 'distribution': module.distribution(lengths), 'requiredPadding': maximum_length, 'seconds': time.monotonic() - started, 'rows': result, 'solJobsSubmitted': 0}
    (directory / 'current-token-audit.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({key: value for key, value in report.items() if key != 'rows'}), flush=True)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    parser.add_argument('archive', type=Path)
    args = parser.parse_args()
    audit(args.directory, args.archive)
