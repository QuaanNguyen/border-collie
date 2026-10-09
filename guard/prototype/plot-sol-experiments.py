import argparse
import csv
import json
import os
from pathlib import Path

os.environ.setdefault('MPLCONFIGDIR', '/private/tmp/border-collie-matplotlib')
os.environ.setdefault('XDG_CACHE_HOME', '/private/tmp/border-collie-chart-cache')
Path(os.environ['XDG_CACHE_HOME']).mkdir(parents=True, exist_ok=True)

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import PercentFormatter


def read_csv(path):
    with path.open() as handle:
        return list(csv.DictReader(handle))


def plot(directories, output):
    experiments = [json.loads((directory / 'experiment.json').read_text()) for directory in directories]
    for experiment in experiments[1:]:
        for file in ['validation-scenarios.jsonl', 'held-out-scenarios.jsonl']:
            if experiment['hashes'][file] != experiments[0]['hashes'][file]:
                raise ValueError('Experiments use different evaluation cases: ' + file)
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 11, 'axes.spines.top': False, 'axes.spines.right': False, 'axes.titleweight': 'bold'})
    colors = ['#2066a8', '#d06a26', '#32846a', '#9657a5']
    figure, axes = plt.subplots(1, 2, figsize=(12, 4.8), constrained_layout=True)
    for index, (directory, experiment) in enumerate(zip(directories, experiments)):
        rows = read_csv(directory / 'epochs.csv')
        label = f'{experiment["distributions"]["train"]["count"]:,} samples, seed {experiment["seed"]}'
        color = colors[index % len(colors)]
        for axis, xfield in zip(axes, ['epoch', 'global_step']):
            xs = [int(row[xfield]) for row in rows]
            axis.plot(xs, [float(row['validation_loss']) for row in rows], color=color, marker='o', markersize=4, label=label + ' validation')
            axis.plot(xs, [float(row['train_loss']) for row in rows], color=color, linestyle='--', alpha=0.7, label=label + ' training')
            axis.grid(alpha=0.2)
            axis.set_ylabel('Answer cross-entropy loss')
    axes[0].set(title='Loss by epoch', xlabel='Completed epochs')
    axes[1].set(title='Loss by optimizer step', xlabel='Optimizer updates')
    axes[0].legend(frameon=False, fontsize=9)
    figure.suptitle('Needle Judge fine-tuning | frozen 100-case validation', fontsize=15, fontweight='bold')
    figure.savefig(output / 'training-curves.png', dpi=180)
    figure.savefig(output / 'training-curves.svg')
    plt.close(figure)
    measurements = []
    baseline = read_csv(directories[0] / 'base-summary.csv')
    measurements.append(('Base Needle', baseline))
    for directory, experiment in zip(directories, experiments):
        candidate_digests = set()
        for model in ['best', 'final']:
            file = directory / (model + '-summary.csv')
            if file.exists():
                rows = read_csv(file)
                digest = rows[0]['weights_sha256']
                if digest in candidate_digests:
                    continue
                candidate_digests.add(digest)
                count = experiment['distributions']['train']['count']
                measurements.append((f'{count:,} samples ({model})', rows))
    fields = [('accuracy', 'Verdict accuracy'), ('harmful_allowed_rate', 'Harmful actions allowed'), ('ordinary_refused_rate', 'Ordinary actions refused'), ('ask_recall', 'Confirmation recall')]
    figure, axes = plt.subplots(1, 2, figsize=(12, 5.6))
    figure.subplots_adjust(left=0.055, right=0.99, top=0.80, bottom=0.22, wspace=0.20)
    width = 0.8 / len(measurements)
    for axis, split, title in zip(axes, ['validation', 'heldOut'], ['Validation | 100 cases', 'Held-out evaluation | 300 cases']):
        for index, (label, rows) in enumerate(measurements):
            row = next(row for row in rows if row['split'] == split and row['group'] == 'overall')
            values = [float(row[field]) if row[field] else 0 for field, _ in fields]
            positions = [value - 0.4 + width / 2 + index * width for value in range(len(fields))]
            bars = axis.bar(positions, values, width=width, label=label, color=['#7c8796', *colors][index % (len(colors) + 1)])
            axis.bar_label(bars, labels=[f'{value:.1%}' for value in values], fontsize=8, padding=3)
        axis.set_xticks(range(len(fields)), [label.replace(' ', '\n', 1) for _, label in fields], fontsize=9)
        axis.set_ylim(0, 1.08)
        axis.yaxis.set_major_formatter(PercentFormatter(1))
        axis.set_title(title)
        axis.grid(axis='y', alpha=0.2)
        axis.set_axisbelow(True)
    handles, labels = axes[0].get_legend_handles_labels()
    figure.legend(handles, labels, frameon=False, fontsize=9, loc='upper center', bbox_to_anchor=(0.5, 0.92), ncol=min(4, len(labels)))
    figure.suptitle('Base Needle vs fine-tuned Judge', fontsize=15, fontweight='bold', y=0.985)
    figure.supxlabel('Higher accuracy and confirmation recall are better. Lower harmful approvals and ordinary refusals are better.', fontsize=9, y=0.03)
    figure.savefig(output / 'base-comparison.png', dpi=180)
    figure.savefig(output / 'base-comparison.svg')
    plt.close(figure)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directories', nargs='+', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    output = args.output or args.directories[0]
    output.mkdir(parents=True, exist_ok=True)
    plot(args.directories, output)
