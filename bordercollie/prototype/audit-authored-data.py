import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re


def digest(value):
    if not isinstance(value, str):
        value = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    return hashlib.sha256(value.encode()).hexdigest()


def audit(directory):
    directory = Path(directory)
    contents = (directory / 'proposals.jsonl').read_text()
    manifest = json.loads((directory / 'manifest.json').read_text())
    packet = json.loads((directory / 'review-packet.json').read_text())
    rows = [json.loads(line) for line in contents.splitlines() if line]
    requests = packet['requests']
    if not rows or len(rows) != len(requests) or manifest['cases'] != len(rows):
        raise ValueError('Missing or inconsistent proposal and request counts')
    if manifest['proposalsSha256'] != digest(contents):
        raise ValueError('Frozen proposals changed')
    if manifest['requestsSha256'] != digest(requests):
        raise ValueError('Frozen review requests changed')
    families = {}
    identifiers = set()
    inputs = set()
    split_counts = Counter()
    tool_counts = Counter()
    features = Counter()
    for row, request in zip(rows, requests):
        if row['id'] in identifiers or request['id'] != row['id']:
            raise ValueError('Duplicated or mismatched case identity')
        identifiers.add(row['id'])
        if row['split'] not in ('train', 'validation', 'test'):
            raise ValueError('Unknown data split')
        if row['family'] in families and families[row['family']] != row['split']:
            raise ValueError('A scenario family crosses data splits')
        families[row['family']] = row['split']
        if row.get('trainingEligible') is not False:
            raise ValueError('Unqualified authored data cannot claim training eligibility')
        if request.get('version') != '3':
            raise ValueError('Historical request format is not current V3 data')
        exact = {key: request[key] for key in ('version', 'query', 'tools')}
        if request['inputHash'] != digest(exact) or request['inputHash'] in inputs:
            raise ValueError('Changed or duplicated production input')
        inputs.add(request['inputHash'])
        if [tool['name'] for tool in request['tools']] != ['approve', 'deny', 'ask']:
            raise ValueError('The three current direct verdict tools are required')
        prefix = 'Folder Preference:\n' + row['preference']['text'] + '\n\nUser request: ' + row['userMessage'] + '. Agent action: ' + row['tool'] + ' '
        if not request['query'].startswith(prefix):
            raise ValueError('The complete authored input is absent from the production request')
        action, end = json.JSONDecoder().raw_decode(request['query'][len(prefix):])
        if action != row['args'] or not request['query'][len(prefix) + end:].startswith('. Effects: '):
            raise ValueError('The complete action arguments are absent from the production request')
        split_counts[row['split']] += 1
        tool_counts[row['agent'] + ':' + row['tool']] += 1
        command = row['args'].get('command', row['args'].get('cmd', '')) if isinstance(row['args'], dict) else ''
        if isinstance(command, list):
            command = '\n'.join(command)
        if isinstance(command, str) and command:
            features['shellCalls'] += 1
            features['multiline'] += '\n' in command
            features['variables'] += bool(re.search(r'\$[A-Za-z_{]', command))
            features['commandSubstitution'] += '$(' in command or '`' in command
            features['heredocs'] += '<<' in command
            features['scriptInvocation'] += bool(re.search(r'\b(?:bash|sh|python3?|node)\b', command))
    return {
        'status': 'complete-integrity-check',
        'cases': len(rows),
        'families': len(families),
        'splits': dict(split_counts),
        'tools': dict(tool_counts),
        'shellFeatures': dict(features),
        'proposalsSha256': digest(contents),
        'requestsSha256': digest(requests),
        'generatedCommandsExecuted': False,
        'trainingEligible': False,
        'humanVerified': False,
        'modelQualityMeasured': False,
        'scope': 'Frozen input integrity and visible request checks only. No schema, label, tokenizer, runtime interception, or model qualification is implied.',
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    parser.add_argument('new_report', type=Path)
    args = parser.parse_args()
    if args.new_report.exists():
        raise FileExistsError('Preserve existing audit reports; choose a new output')
    report = audit(args.directory)
    with args.new_report.open('x') as output:
        output.write(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
