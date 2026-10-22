import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import re


def inspect(directories):
    if not directories:
        raise ValueError('At least one frozen snapshot is required')
    rows = []
    sources = []
    for directory in directories:
        directory = Path(directory).resolve()
        manifest_bytes = (directory / 'manifest.json').read_bytes()
        proposals = (directory / 'proposals.jsonl').read_bytes()
        manifest = json.loads(manifest_bytes)
        if hashlib.sha256(proposals).hexdigest() != manifest['proposalsSha256']:
            raise ValueError(f'Frozen proposal bytes changed: {directory}')
        values = [json.loads(line) for line in proposals.splitlines() if line.strip()]
        if not values or len(values) != manifest['cases'] or len({row['id'] for row in values}) != len(values):
            raise ValueError(f'Invalid frozen identities: {directory}')
        packet_bytes = (directory / 'review-packet.json').read_bytes()
        packets = json.loads(packet_bytes)['requests']
        packet_hash = hashlib.sha256(json.dumps(packets, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
        if packet_hash != manifest['requestsSha256']:
            raise ValueError(f'Frozen request packet changed: {directory}')
        for packet in packets:
            visible = {key: value for key, value in packet.items() if key not in ('id', 'inputHash')}
            visible_hash = hashlib.sha256(json.dumps(visible, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
            if packet['inputHash'] != visible_hash:
                raise ValueError(f'Visible request hash changed: {packet["id"]}')
        if len(packets) != len(values) or len({row['id'] for row in packets}) != len(packets):
            raise ValueError(f'Invalid frozen packet identities: {directory}')
        captured = {row['id']: row for row in packets}
        for row in values:
            packet = captured.get(row['id'])
            if packet is None or row.get('inputHash', packet['inputHash']) != packet['inputHash']:
                raise ValueError(f'Proposal/packet identity mismatch: {row["id"]}')
            if row['split'] not in ('train', 'validation', 'test'):
                raise ValueError(f'Unsupported dataset split: {row["id"]}')
            rows.append({**row, 'inputHash': packet['inputHash'], 'source': str(directory)})
        sources.append({'directory': str(directory), 'manifestSha256': hashlib.sha256(manifest_bytes).hexdigest(), 'proposalsSha256': hashlib.sha256(proposals).hexdigest(), 'packetSha256': hashlib.sha256(packet_bytes).hexdigest()})
    inputs = defaultdict(list)
    families = defaultdict(list)
    by_tool = defaultdict(list)
    for row in rows:
        inputs[row['inputHash']].append(row)
        families[row['family']].append(row)
        text = re.sub(r'https?://\S+|\b[\w.-]+\.example\b', '<domain>', row['userMessage'].lower())
        words = re.findall(r'[a-z0-9_]+', text)
        shingles = set(zip(words, words[1:], words[2:]))
        by_tool[(row['agent'], row['tool'])].append((row, shingles))
    identity = lambda row: {key: row[key] for key in ('id', 'split', 'source', 'inputHash')}
    exact = [[identity(row) for row in group] for group in inputs.values() if len({row['split'] for row in group}) > 1]
    crossed = [{'family': family, 'rows': [identity(row) for row in group]} for family, group in families.items() if len({row['split'] for row in group}) > 1]
    similar = []
    for group in by_tool.values():
        for index, (left, a) in enumerate(group):
            if len(a) < 6:
                continue
            for right, b in group[index + 1:]:
                if left['split'] == right['split'] or len(b) < 6:
                    continue
                score = len(a & b) / len(a | b)
                if score >= 0.8:
                    similar.append({'left': identity(left), 'right': identity(right), 'similarity': round(score, 4)})
    return {'status': 'overlap-found' if exact or crossed else 'exact-overlap-check-passed', 'cases': len(rows), 'sources': sources, 'crossSplitExactInputs': exact, 'crossSplitFamilies': crossed, 'nearDuplicateCandidates': similar, 'nearDuplicateMeaning': 'Same-tool user wording with trigram Jaccard similarity at least 0.8. Candidates require semantic inspection; this is not a proof of independent evaluation.', 'blindEvaluationQualified': False, 'humanVerificationAssessed': False, 'generatedCommandsExecuted': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('snapshots', nargs='+', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise FileExistsError('Preserve prior audit reports; choose a new output')
    result = inspect(args.snapshots)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: len(value) if isinstance(value, list) else value for key, value in result.items() if key not in ('sources', 'nearDuplicateMeaning')}))
    raise SystemExit(1 if result['status'] == 'overlap-found' else 0)
