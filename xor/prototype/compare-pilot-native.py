import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import random
import statistics


spec = importlib.util.spec_from_file_location('pilot_metrics', Path(__file__).with_name('summarize-v2-pilot.py'))
pilot_metrics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot_metrics)


def describe(rows):
    latencies = sorted(row['latencySeconds'] for row in rows)
    return pilot_metrics.metrics(rows) | {'latency95Seconds': latencies[math.ceil(len(latencies) * 0.95) - 1] if latencies else None, 'latencyMaximumSeconds': max(latencies) if latencies else None, 'counts': {
        'allowCases': sum(row['expected'] == 'allow' for row in rows),
        'disallowCases': sum(row['expected'] == 'disallow' for row in rows),
        'askCases': sum(row['expected'] == 'ask' for row in rows),
        'correct': sum(row['observed'] == row['expected'] for row in rows),
        'prohibitedApprovals': sum(row['expected'] == 'disallow' and row['observed'] == 'allow' for row in rows),
        'ordinaryRefusals': sum(row['expected'] == 'allow' and row['observed'] != 'allow' for row in rows),
        'missingVerdicts': sum(row['observed'] is None for row in rows),
    }}


def details(evidence):
    output = {}
    for split in sorted({row['split'] for row in evidence['rows']}):
        rows = [row for row in evidence['rows'] if row['split'] == split]
        families = {}
        for row in rows:
            families.setdefault(row['family'], []).append(row)
        contrasts = [group for group in families.values() if len({row['expected'] for row in group}) > 1]
        output[split] = {'metrics': describe(rows), 'breakdowns': {dimension: {value: describe([row for row in rows if row[dimension] == value]) for value in sorted({row[dimension] for row in rows})} for dimension in ['topic', 'category', 'preference']}, 'permissionContrasts': {'families': len(contrasts), 'allCorrectFamilies': sum(all(row['expected'] == row['observed'] for row in group) for group in contrasts)}}
    return output


def compare(references, candidates, repetitions=5000):
    if len(references) == 1:
        references = references * len(candidates)
    if not candidates or len(references) != len(candidates):
        raise RuntimeError('Every candidate needs a matched reference')
    identity = lambda row: (row['id'], row['inputHash'], row['expected'], row['family'])
    expected = [identity(row) for row in references[0]]
    if not expected or any([identity(row) for row in rows] != expected for rows in references + candidates):
        raise RuntimeError('Evaluation cases or expected Verdicts do not match')
    if any(row['infrastructureError'] for rows in references + candidates for row in rows):
        raise RuntimeError('An infrastructure failure invalidates comparison')
    pairs = [{'reference': describe(reference), 'candidate': describe(candidate)} for reference, candidate in zip(references, candidates)]
    differences = {}
    for metric in ['accuracy', 'harmfulAllowed', 'ordinaryRefused', 'askPrecision', 'askRecall', 'missingVerdict']:
        values = [pair['candidate'][metric] - pair['reference'][metric] for pair in pairs if pair['candidate'][metric] is not None and pair['reference'][metric] is not None]
        differences[metric] = {'meanChange': statistics.mean(values) if values else None, 'standardDeviation': statistics.stdev(values) if len(values) > 1 else None, 'perSeedChanges': values}
    families = {}
    for index, row in enumerate(references[0]):
        families.setdefault(row['family'], []).append(index)
    groups = list(families.values())
    changes = [[sum((candidate[index]['observed'] == candidate[index]['expected']) - (reference[index]['observed'] == reference[index]['expected']) for index in group) for group in groups] for reference, candidate in zip(references, candidates)]
    rng = random.Random(20261016)
    bootstrap = []
    for _ in range(repetitions):
        sampled_families = rng.choices(range(len(groups)), k=len(groups))
        sampled_seeds = rng.choices(range(len(candidates)), k=len(candidates))
        denominator = sum(len(groups[index]) for index in sampled_families) * len(sampled_seeds)
        bootstrap.append(sum(changes[seed][family] for seed in sampled_seeds for family in sampled_families) / denominator)
    bootstrap.sort()
    interval = [bootstrap[int(repetitions * 0.025)], bootstrap[min(repetitions - 1, int(repetitions * 0.975))]]
    return {'seeds': len(candidates), 'casesPerSeed': len(expected), 'families': len(groups), 'pairs': pairs, 'differences': differences, 'accuracyChange95PercentInterval': interval, 'uncertaintyMethod': f'Paired family-block bootstrap with seed resampling, {repetitions} draws, fixed seed 20261016. Development evidence only.'}


def summarize(directory):
    plan_file = directory / 'study-plan.json'
    plan = json.loads(plan_file.read_text())
    plan_hash = hashlib.sha256(plan_file.read_bytes()).hexdigest()
    expected = {}
    for split in plan['evaluationSplits']:
        file = directory / f'{split}-requests.jsonl'
        if hashlib.sha256(file.read_bytes()).hexdigest() != plan['hashes'][file.name]:
            raise RuntimeError('Frozen evaluation requests changed')
        expected[split] = [json.loads(line) for line in file.read_text().splitlines()]
    evaluations, failures = {}, []
    runtime = None
    labels = ['matched-untuned', *(setting['label'] for setting in plan['runs']), *('old-data-seed' + str(seed) for seed in plan['seeds'])]
    for label in labels:
        file = directory / 'native-evaluations' / (label + '.json')
        if not file.exists():
            continue
        evidence = json.loads(file.read_text())
        if evidence['status'] != 'complete':
            failures.append({'file': file.name, 'status': evidence['status']})
            continue
        if evidence['studyPlanSha256'] != plan_hash:
            raise RuntimeError('Native result belongs to a different study')
        identity = (evidence['runnerSha256'], evidence['platform'], json.dumps(evidence['runtime'], sort_keys=True))
        if runtime is not None and identity != runtime:
            raise RuntimeError('Native runtime settings differ across model comparisons')
        runtime = identity
        for split, rows in expected.items():
            actual = [row for row in evidence['rows'] if row['split'] == split]
            if [(row['id'], row['inputHash'], row['expected'], row['family']) for row in actual] != [(row['id'], row['inputHash'], row['expected'], row['family']) for row in rows]:
                raise RuntimeError('Missing, reordered, or changed native evaluation cases')
        evaluations[evidence['label']] = evidence
    baseline = evaluations.get('matched-untuned')
    if baseline is None:
        raise RuntimeError('A complete matched untuned baseline is required')
    groups = {}
    pending = []
    for setting in plan['runs']:
        if setting['size'] == 0:
            continue
        rank = setting.get('training', {}).get('loraRank', plan['training']['loraRank'])
        key = (setting['experiment'], rank, setting['updates'])
        groups.setdefault(key, [])
        if setting['label'] not in evaluations:
            pending.append(setting['label'])
        else:
            groups[key].append((setting, evaluations[setting['label']]))
    comparisons = []
    for (experiment, rank, updates), members in groups.items():
        if not members:
            continue
        members.sort(key=lambda pair: pair[0]['seed'])
        for split in plan['evaluationSplits']:
            rows = lambda evidence: [row for row in evidence['rows'] if row['split'] == split]
            entry = {'experiment': experiment, 'rank': rank, 'updates': updates, 'split': split, 'seedIds': [setting['seed'] for setting, _ in members], 'allRegisteredSeedsComplete': [setting['seed'] for setting, _ in members] == plan['seeds'], 'againstUntuned': compare([rows(baseline)], [rows(evidence) for _, evidence in members]), 'selectionEligible': split == 'validation' and len(members) == len(plan['seeds'])}
            entry['selectionEligible'] = split == 'validation' and entry['allRegisteredSeedsComplete']
            prior = [evaluations.get('old-data-seed' + str(setting['seed'])) for setting, _ in members]
            if experiment == 'target-format-control' and rank == 16 and updates == 300 and all(prior):
                entry['againstPriorData'] = compare([rows(evidence) for evidence in prior], [rows(evidence) for _, evidence in members])
                entry['priorDataComparisonScope'] = 'Matched 1000-case, rank-16, 300-update reasoning-target controls. The revised input contract, reviewed labels, selected examples and padding differ; this measures their combined effect.'
            comparisons.append(entry)
    report = {'generatedBy': 'bordercollie/prototype/compare-pilot-native.py', 'status': 'complete' if not pending and not failures else 'partial', 'studyPlanSha256': plan_hash, 'baseline': {split: describe([row for row in baseline['rows'] if row['split'] == split]) for split in plan['evaluationSplits']}, 'priorDataModels': {label: {split: describe([row for row in evidence['rows'] if row['split'] == split]) for split in plan['evaluationSplits']} for label, evidence in evaluations.items() if label.startswith('old-data-seed')}, 'comparisons': comparisons, 'pendingConditions': pending, 'failedOrUnfinishedEvaluations': failures, 'promotionAllowed': False, 'limits': plan['limits'], 'interpretation': 'Select settings using development validation only after all three seeds complete. Historical diagnostics cannot select a seed or setting. Neither data provenance nor better development accuracy establishes blind safety performance.'}
    report['modelDetails'] = {label: details(evidence) for label, evidence in evaluations.items()}
    (directory / 'native-comparison.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': report['status'], 'comparisons': len(comparisons), 'pendingConditions': len(pending), 'promotionAllowed': False}))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    summarize(parser.parse_args().directory.resolve())
