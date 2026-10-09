from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path


WORKSPACE = Path(__file__).resolve().parents[1]
TRAIN = WORKSPACE / 'snapshot/guard/prototype/output/needle-official-ladder/train-1000-scenarios.jsonl'
HELD_OUT = WORKSPACE / 'snapshot/guard/prototype/data/stage2/held-out.jsonl'


def read_rows(file):
    return [json.loads(line) for line in file.read_text().splitlines() if line]


def evaluate(fields, train, held_out):
    votes = defaultdict(Counter)
    for row in train:
        votes[tuple(row[field] for field in fields)][row['verdict']] += 1
    fallback = Counter(row['verdict'] for row in train).most_common(1)[0][0]
    decisions = []
    for row in held_out:
        count = votes.get(tuple(row[field] for field in fields))
        observed = count.most_common(1)[0][0] if count else fallback
        decisions.append({'id': row['id'], 'expected': row['verdict'], 'observed': observed, 'unseenCombination': count is None})
    correct = sum(row['expected'] == row['observed'] for row in decisions)
    return {'metadataFields': fields, 'correct': correct, 'total': len(decisions), 'accuracy': correct / len(decisions), 'unseenCombinations': sum(row['unseenCombination'] for row in decisions), 'decisions': decisions}


train = read_rows(TRAIN)
held_out = read_rows(HELD_OUT)
if set(row['family'] for row in train) & set(row['family'] for row in held_out):
    raise RuntimeError('Historical training and held-out families overlap')
report = {
    'purpose': 'Oracle metadata diagnostic of synthetic label structure, not a usable permission Judge or a production baseline.',
    'visibleUserMessagesOrActionsReadByPredictor': False,
    'metadataAvailableToRealJudge': False,
    'trainingCases': len(train),
    'heldOutCases': len(held_out),
    'trainingSha256': hashlib.sha256(TRAIN.read_bytes()).hexdigest(),
    'heldOutSha256': hashlib.sha256(HELD_OUT.read_bytes()).hexdigest(),
    'requestFormatVersion': '1',
    'method': 'Most frequent training verdict for each metadata combination; ties follow first observed verdict; unseen combinations use the training majority.',
    'results': [evaluate(fields, train, held_out) for fields in [['preferenceId', 'category'], ['preferenceId', 'category', 'tool']]],
    'sourceFilesChanged': False,
    'solContacted': False,
}
(WORKSPACE / 'artifacts/metadata-check.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({**{key: value for key, value in report.items() if key != 'results'}, 'results': [{key: value for key, value in row.items() if key != 'decisions'} for row in report['results']]}, indent=2))
