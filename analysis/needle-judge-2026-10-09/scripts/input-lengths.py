import ast
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import struct


WORKSPACE = Path(__file__).resolve().parents[1]
ARTIFACTS = WORKSPACE / 'artifacts'
REVISION = 'ef3cf7543204d99878c0dd913a05f6a506da4be8'
PUBLIC_SOURCE = ARTIFACTS / 'public-source' / REVISION


def load_official_definitions():
    manifest = json.loads((PUBLIC_SOURCE / 'provenance.json').read_text())
    for record in manifest['records']:
        if hashlib.sha256((WORKSPACE / record['file']).read_bytes()).hexdigest() != record['sha256']:
            raise RuntimeError('Official source changed after capture')
    definitions = []
    constants = {'TAG', 'FP16', 'FP32', 'CQ', 'RAW', 'TK_NORMAL', 'TK_UNKNOWN', 'TK_CONTROL', 'TK_USER_DEFINED', 'TK_BYTE', '_HDR_FMT', '_REC_FMT', 'REC_SIZE', '_TK_HDR', '_TK_REC', '_SP_META_SPACE', 'IM_START', 'IM_END', 'THINK_START', 'THINK_END', 'TOOLS_START', 'TOOLS_END', 'TOOL_CALL_START', 'TOOL_CALL_END'}
    functions = {'read_tokenizer_blob', 'parse_tokenizer_blob', 'render_example'}
    for file in ('export.py.txt', 'tokenizer.py.txt', 'finetune.py.txt'):
        tree = ast.parse((PUBLIC_SOURCE / file).read_text())
        for node in tree.body:
            if isinstance(node, ast.Assign):
                assigned = {item.id for target in node.targets for item in ast.walk(target) if isinstance(item, ast.Name)}
                if assigned & constants:
                    definitions.append(node)
            elif isinstance(node, ast.FunctionDef) and node.name in functions:
                definitions.append(node)
            elif isinstance(node, ast.ClassDef) and node.name == 'RefTokenizer':
                definitions.append(node)
    module = ast.Module(body=definitions, type_ignores=[])
    namespace = {'struct': struct, 'json': json}
    exec(compile(ast.fix_missing_locations(module), '<pinned official tokenizer and renderer>', 'exec'), namespace)
    return namespace


def read_rows(file):
    return [json.loads(line) for line in file.read_text().splitlines() if line]


def distribution(lengths):
    ordered = sorted(lengths)
    return {'count': len(ordered), 'minimum': ordered[0], 'median': ordered[len(ordered) // 2], 'p95': ordered[int((len(ordered) - 1) * 0.95)], 'maximum': ordered[-1], 'over512': sum(value > 512 for value in ordered), 'over1024': sum(value > 1024 for value in ordered), 'over2048': sum(value > 2048 for value in ordered), 'over4096': sum(value > 4096 for value in ordered)}


def main():
    official = load_official_definitions()
    models = sorted((ARTIFACTS / 'local-probe-models').glob('*/candidate.cact'))
    if len(models) != 2:
        raise RuntimeError('Both isolated historical model copies are required')
    blobs = [official['read_tokenizer_blob'](file) for file in models]
    if blobs[0] != blobs[1]:
        raise RuntimeError('Historical model tokenizers differ')
    tokenizer = official['RefTokenizer'](official['parse_tokenizer_blob'](blobs[0]))
    tokenizer._bpe = lru_cache(maxsize=8192)(tokenizer._bpe)
    render = official['render_example']
    results = []
    details = []
    for name in ('original', 'candidate-all'):
        requests = read_rows(ARTIFACTS / (name + '-requests.jsonl'))
        lengths = []
        for index, row in enumerate(requests):
            sizes = {}
            for tool in ('allow_call', 'block_call', 'ask_owner'):
                prompt, target = render({**row['input'], 'answers': [{'name': tool, 'arguments': {}}]})
                sizes[tool] = len(tokenizer.encode(prompt)) + len(tokenizer.encode(target)) + 2
            largest = max(sizes.values())
            lengths.append(largest)
            details.append({'set': name, 'id': row['id'], 'maximumTokensIncludingTarget': largest, 'byVerdictTool': sizes})
            if (index + 1) % 500 == 0:
                print(json.dumps({'set': name, 'checked': index + 1, 'total': len(requests)}), flush=True)
        results.append({'set': name, 'sourceSha256': hashlib.sha256((ARTIFACTS / (name + '-requests.jsonl')).read_bytes()).hexdigest(), **distribution(lengths)})
    candidate = next(row for row in results if row['set'] == 'candidate-all')
    bucket = 128
    while bucket < candidate['maximum']:
        bucket *= 2
    profile = {
        'status': 'complete-reference-tokenizer-check',
        'officialSourceRevision': REVISION,
        'tokenizerSource': 'Identical packaged tokenizer extracted from both isolated historical four-bit exports.',
        'tokenizerBlobSha256': hashlib.sha256(blobs[0]).hexdigest(),
        'vocabulary': len(tokenizer.pieces),
        'renderer': 'Unmodified official training render function with answers-only targets, including beginning and ending tokens.',
        'encoder': 'Unmodified official archive reference encoder, with a cache around its pure BPE segment method.',
        'allThreeVerdictTargetsChecked': True,
        'suggestedTrainingMaximumLength': bucket,
        'recheckAgainstFutureInstalledTrainerRequired': True,
        'solContacted': False,
        'modelTrainingPerformed': False,
        'results': results,
    }
    (ARTIFACTS / 'input-token-lengths.json').write_text(json.dumps(profile, indent=2) + '\n')
    (ARTIFACTS / 'input-token-length-details.jsonl').write_text(''.join(json.dumps(row) + '\n' for row in details))
    print(json.dumps(profile, indent=2))


if __name__ == '__main__':
    main()
