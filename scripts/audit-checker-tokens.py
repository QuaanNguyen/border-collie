#!/usr/bin/env python3
import argparse
import ast
from functools import lru_cache
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
TOKENIZER_SHA256 = '9f839cd44027ea9203738897da2bac572a5cc77aec7fceacd4391fc412a3249f'
LOADER_SHA256 = '6b4ded622073743df781dee3ac45cc54c3825b9ed83001c6e1cb64ca38ebdb56'
PREPARER_SHA256 = '5d41bdc6c03555cc1a0db5f775ce33ca25ee70aa7893ac9f7329f984750048b5'
PROVENANCE_SHA256 = 'bca6381423a3432f9ef8f36ad232236e12904d474db552b755a85534bf82f1f2'
VERDICTS = ('approve', 'deny', 'ask')
VERIFY_SNAPSHOT = '''
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const data = require(path.resolve('xor/prototype/checker-data.js'));
const directory = process.argv[1];
const contents = fs.readFileSync(path.join(directory, 'proposals.jsonl'), 'utf8');
const rows = contents.trim().split(/\\r?\\n/).map(JSON.parse);
const packet = JSON.parse(fs.readFileSync(path.join(directory, 'review-packet.json')));
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')));
assert.equal(manifest.requestFormatVersion, '3', 'Current request format is required');
assert.equal(manifest.proposalsSha256, data.digest(contents), 'Proposal hash changed');
assert.equal(manifest.cases, rows.length, 'Case count changed');
assert.equal(new Set(rows.map(row => row.id)).size, rows.length, 'Duplicate case IDs');
const rebuilt = data.reviewPacket(rows);
assert.deepEqual(packet.requests, rebuilt, 'Captured inputs differ from production inputs');
assert.equal(manifest.requestsSha256, data.digest(rebuilt), 'Request hash changed');
assert.equal(packet.instructionHash, data.REVIEW_INSTRUCTION_HASH, 'Review rubric changed');
assert.equal(packet.instructions, data.REVIEW_INSTRUCTIONS, 'Review instructions changed');
rows.forEach((row, index) => {
  if (row.inputHash !== undefined) assert.equal(row.inputHash, rebuilt[index].inputHash, 'Proposal input hash changed');
});
process.stdout.write(JSON.stringify({cases: rows.length, productionInputsVerified: true}));
'''


def sha256(contents):
    return hashlib.sha256(contents).hexdigest()


def pinned_module(name, file, expected):
    if sha256(file.read_bytes()) != expected:
        raise ValueError(f'Pinned helper source changed: {file}')
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def distribution(lengths, maximum):
    ordered = sorted(lengths)
    return {
        'count': len(ordered),
        'minimum': ordered[0],
        'median': ordered[len(ordered) // 2],
        'p95': ordered[int((len(ordered) - 1) * 0.95)],
        'maximum': ordered[-1],
        'overConfiguredLimit': sum(length > maximum for length in ordered),
    }


def audit(directory, archive, output, maximum):
    if maximum < 1:
        raise ValueError('Maximum length must be positive')
    if output.exists():
        raise FileExistsError('Preserve existing token reports; choose a new output')
    files = {name: directory / name for name in ('manifest.json', 'proposals.jsonl', 'review-packet.json')}
    captured = {name: file.read_bytes() for name, file in files.items()}
    verification = subprocess.run(['node', '-e', VERIFY_SNAPSHOT, str(directory.resolve())], cwd=ROOT, capture_output=True, text=True)
    if verification.returncode:
        raise ValueError(f'Frozen input verification failed:\n{verification.stderr}')
    packet = json.loads(captured['review-packet.json'])
    proposals = [json.loads(line) for line in captured['proposals.jsonl'].decode().splitlines() if line]
    if not proposals:
        raise ValueError('A token audit requires at least one case')
    loader_file = ROOT / 'analysis/needle-judge-2026-10-09/scripts/input-lengths.py'
    loader = pinned_module('pinned_input_lengths', loader_file, LOADER_SHA256)
    if sha256((loader.PUBLIC_SOURCE / 'provenance.json').read_bytes()) != PROVENANCE_SHA256:
        raise ValueError('Pinned official source provenance changed')
    official = loader.load_official_definitions()
    blob = official['read_tokenizer_blob'](archive)
    if sha256(blob) != TOKENIZER_SHA256:
        raise ValueError('Pinned official tokenizer blob changed')
    tokenizer = official['RefTokenizer'](official['parse_tokenizer_blob'](blob))
    tokenizer._bpe = lru_cache(maxsize=32768)(tokenizer._bpe)
    preparer_file = ROOT / 'xor/prototype/prepare_direct_trainer.py'
    preparer = pinned_module('pinned_direct_preparer', preparer_file, PREPARER_SHA256)
    trainer = loader.PUBLIC_SOURCE / 'finetune.py.txt'
    with tempfile.TemporaryDirectory(prefix='checker-token-renderer-') as scratch:
        prepared = Path(scratch) / 'direct-trainer.py'
        direct_sha256 = preparer.prepare(trainer, prepared)
        functions = [node for node in ast.parse(prepared.read_text()).body if isinstance(node, ast.FunctionDef) and node.name == 'render_example']
        if len(functions) != 1:
            raise ValueError('Prepared trainer must have one example renderer')
        direct_namespace = dict(official)
        exec(compile(ast.fix_missing_locations(ast.Module(body=functions, type_ignores=[])), '<pinned prepared direct renderer>', 'exec'), direct_namespace)
    renderers = {'official': official['render_example'], 'emptyThinkingDirect': direct_namespace['render_example']}
    details = []
    for index, (proposal, request) in enumerate(zip(proposals, packet['requests'], strict=True)):
        lengths = {}
        for name, render in renderers.items():
            sizes = {}
            for verdict in VERDICTS:
                prompt, target = render({'query': request['query'], 'tools': request['tools'], 'answers': [{'name': verdict, 'arguments': {}}]})
                sizes[verdict] = len(tokenizer.encode(prompt)) + len(tokenizer.encode(target)) + 2
            lengths[name] = {'byVerdict': sizes, 'maximumTokens': max(sizes.values())}
        details.append({'id': proposal['id'], 'inputHash': request['inputHash'], 'split': proposal['split'], 'agent': proposal['agent'], 'tool': proposal['tool'], 'renderers': lengths})
        if (index + 1) % 100 == 0:
            print(json.dumps({'checked': index + 1, 'total': len(proposals)}), flush=True)
    summaries = {name: distribution([row['renderers'][name]['maximumTokens'] for row in details], maximum) for name in renderers}
    largest = max(summary['maximum'] for summary in summaries.values())
    padding = 128
    while padding < largest:
        padding *= 2
    for name, file in files.items():
        if file.read_bytes() != captured[name]:
            raise ValueError(f'Frozen input changed during audit: {name}')
    manifest = json.loads(captured['manifest.json'])
    report = {
        'status': 'length-limit-exceeded' if largest > maximum else 'complete',
        'configuredMaximumLength': maximum,
        'suggestedPaddingWithoutTruncation': padding,
        'allThreeVerdictTargetsChecked': True,
        'beginningAndEndingTokensIncluded': True,
        'productionInputsVerified': True,
        'frozenInputsUnchanged': True,
        'inputDirectory': str(directory.resolve()),
        'inputFilesSha256': {name: sha256(contents) for name, contents in captured.items()},
        'requestsSha256': manifest['requestsSha256'],
        'officialSourceRevision': loader.REVISION,
        'officialProvenanceSha256': sha256((loader.PUBLIC_SOURCE / 'provenance.json').read_bytes()),
        'officialTrainerSha256': sha256(trainer.read_bytes()),
        'preparedDirectTrainerSha256': direct_sha256,
        'tokenizerBlobSha256': sha256(blob),
        'sourceFilesSha256': {str(file.relative_to(ROOT)): sha256(file.read_bytes()) for file in (Path(__file__).resolve(), loader_file, preparer_file, ROOT / 'xor/prototype/checker-data.js', ROOT / 'xor/lib/gate.js', ROOT / 'xor/lib/toolcalls.js', ROOT / 'xor/lib/preference.js')},
        'rendererMeaning': {'official': 'Unmodified pinned official renderer with answers-only targets.', 'emptyThinkingDirect': 'Proposed prepared renderer with empty thinking delimiters; not a trained or qualified model.'},
        'trainingEligibilityAssessed': False,
        'humanVerificationAssessed': False,
        'modelTrainingPerformed': False,
        'solJobsSubmitted': 0,
        'results': summaries,
        'rows': details,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x') as target:
        target.write(json.dumps(report, indent=2) + '\n')
    print(json.dumps({key: value for key, value in report.items() if key != 'rows'}, indent=2), flush=True)
    return 1 if largest > maximum else 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--max-length', type=int, default=4096)
    args = parser.parse_args()
    return audit(args.snapshot, args.archive, args.output, args.max_length)


if __name__ == '__main__':
    raise SystemExit(main())
