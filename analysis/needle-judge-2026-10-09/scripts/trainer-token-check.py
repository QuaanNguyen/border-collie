from functools import lru_cache
import hashlib
import importlib.util
import json
from pathlib import Path
import sys


WORKSPACE = Path(__file__).resolve().parents[1]
ARTIFACTS = WORKSPACE / 'artifacts'
sys.path.insert(0, str(ARTIFACTS / 'python-dependencies'))
import sentencepiece


def load_reference():
    file = WORKSPACE / 'scripts/input-lengths.py'
    spec = importlib.util.spec_from_file_location('needle_analysis_lengths', file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, module.load_official_definitions()


def main():
    module, official = load_reference()
    model = ARTIFACTS / 'public-tokenizer/tokenizer.model'
    provenance = json.loads((model.parent / 'provenance.json').read_text())
    if hashlib.sha256(model.read_bytes()).hexdigest() != provenance['sha256']:
        raise RuntimeError('The pinned training tokenizer changed after capture')
    sp = sentencepiece.SentencePieceProcessor(model_file=str(model))
    encode = lru_cache(maxsize=16384)(lambda text: tuple(sp.encode(text, out_type=int)))
    archive = next((ARTIFACTS / 'local-probe-models').glob('*/candidate.cact'))
    blob = official['read_tokenizer_blob'](archive)
    meta = official['parse_tokenizer_blob'](blob)
    if sp.GetPieceSize() != len(meta['pieces']):
        raise RuntimeError('The training and runtime vocabularies differ')
    for index, piece in enumerate(meta['pieces']):
        if sp.IdToPiece(index) != piece or sp.GetScore(index) != meta['scores'][index]:
            raise RuntimeError('The pinned training tokenizer differs from the runtime archive')
    reference = official['RefTokenizer'](meta)
    reference._bpe = lru_cache(maxsize=8192)(reference._bpe)
    render = official['render_example']
    results = []
    details = []
    parity = []
    for name in ('original', 'candidate-all'):
        requests = module.read_rows(ARTIFACTS / (name + '-requests.jsonl'))
        lengths = []
        for index, row in enumerate(requests):
            sizes = {}
            for tool in ('allow_call', 'block_call', 'ask_owner'):
                prompt, target = render({**row['input'], 'answers': [{'name': tool, 'arguments': {}}]})
                sizes[tool] = len(encode(prompt)) + len(encode(target)) + 2
                if tool == 'allow_call' and (index % 257 == 0 or index == len(requests) - 1):
                    matched = tuple(reference.encode(prompt)) == encode(prompt) and tuple(reference.encode(target)) == encode(target)
                    parity.append({'set': name, 'id': row['id'], 'matchedTokenIds': matched})
            largest = max(sizes.values())
            lengths.append(largest)
            details.append({'set': name, 'id': row['id'], 'maximumTokensIncludingTarget': largest, 'byVerdictTool': sizes})
        results.append({'set': name, 'sourceSha256': hashlib.sha256((ARTIFACTS / (name + '-requests.jsonl')).read_bytes()).hexdigest(), **module.distribution(lengths)})
    candidate = next(row for row in results if row['set'] == 'candidate-all')
    profile = {
        'status': 'complete-pinned-training-tokenizer-check',
        'tokenizerModelSha256': provenance['sha256'],
        'tokenizerBlobSha256': hashlib.sha256(blob).hexdigest(),
        'source': provenance['source'],
        'sentencepieceVersion': sentencepiece.__version__,
        'officialRendererSourceRevision': module.REVISION,
        'vocabularyAndScoresMatchRuntimeArchive': True,
        'referenceEncoderParity': {'sampleCount': len(parity), 'allMatched': all(row['matchedTokenIds'] for row in parity), 'cases': parity},
        'allThreeVerdictTargetsChecked': True,
        'maximumLength': 1024,
        'completeCandidateInputsFit': candidate['maximum'] <= 1024,
        'recheckAgainstFutureInstalledTrainerRequired': True,
        'modelTrainingPerformed': False,
        'solContacted': False,
        'results': results,
    }
    (ARTIFACTS / 'trainer-token-check.json').write_text(json.dumps(profile, indent=2) + '\n')
    (ARTIFACTS / 'trainer-token-details.jsonl').write_text(''.join(json.dumps(row) + '\n' for row in details))
    print(json.dumps({key: value for key, value in profile.items() if key != 'referenceEncoderParity'}, indent=2))
    print(json.dumps({'referenceEncoderParitySamples': len(parity), 'allMatched': profile['referenceEncoderParity']['allMatched']}))
    if not profile['completeCandidateInputsFit'] or not profile['referenceEncoderParity']['allMatched']:
        raise RuntimeError('Candidate fit or tokenizer parity failed')


if __name__ == '__main__':
    main()
