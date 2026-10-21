import csv
import json
from pathlib import Path
import sys

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D


def plot(directory):
    rows = list(csv.DictReader((directory / 'batch-comparison.csv').open()))
    fields = [('accuracy', 'Verdict accuracy'), ('balanced_accuracy', 'Mean class recall'), ('harmful_allowed_rate', 'Harmful approvals (lower is better)'), ('ordinary_refused_rate', 'Ordinary refusals (lower is better)'), ('ask_precision', 'Confirmation precision'), ('ask_recall', 'Confirmation recall')]
    for split in ['validation', 'heldOut']:
        figure, axes = plt.subplots(2, 3, figsize=(14, 8.5))
        subset = [row for row in rows if row['split'] == split]
        for axis, (field, title) in zip(axes.flat, fields):
            for seed, color in [('42', '#2563eb'), ('0', '#c2410c')]:
                settings = sorted([row for row in subset if row['seed'] == seed and row['reasoning_targets'] == 'True' and row[field]], key=lambda row: int(row['training_samples']))
                if settings:
                    axis.plot([int(row['training_samples']) for row in settings], [100 * float(row[field]) for row in settings], 'o-', color=color, label=f'Reasoning, seed {seed}')
            for label, color, style, description in [('shipped-base', '#64748b', '--', 'Shipped base (2-bit)'), ('base-local-export', '#059669', ':', 'Untuned export (4-bit)'), ('prior-custom-300-seed42', '#dc2626', '-.', 'Earlier custom training (300)')]:
                baseline = next((row for row in subset if row['model'] == label), None)
                if baseline and baseline[field]:
                    axis.axhline(100 * float(baseline[field]), color=color, linestyle=style, label=description)
            raw = next((row for row in subset if row['model'] == 'raw-300-seed42'), None)
            if raw and raw[field]:
                axis.scatter([300], [100 * float(raw[field])], color='#7c3aed', marker='D', label='No reasoning, seed 42')
            axis.set(title=title, xlabel='Training samples', ylabel='Percent', ylim=(-2, 102), xticks=[100, 300, 600, 1000])
            axis.grid(alpha=0.2)
        handles, labels = axes.flat[0].get_legend_handles_labels()
        figure.legend(handles, labels, loc='lower center', ncol=3, frameon=False)
        platforms = ', '.join(sorted({row['platform'] for row in subset}))
        description = 'Frozen validation (100 cases)' if split == 'validation' else 'Frozen held-out evaluation (300 cases)'
        figure.suptitle(f'Official Needle fine-tuning: {description} on {platforms}')
        figure.tight_layout(rect=(0, 0.09, 1, 0.96))
        for extension in ['png', 'svg']:
            figure.savefig(directory / f'batch-{split}-comparison.{extension}', dpi=180)
        plt.close(figure)
    figure, axes = plt.subplots(1, 2, figsize=(13, 6.2))
    plan = json.loads((directory / 'official-plan.json').read_text())
    colors = {100: '#2563eb', 300: '#c2410c', 600: '#059669', 1000: '#7c3aed'}
    for setting in plan['runs']:
        file = directory / setting['label'] / 'epochs.csv'
        if not file.exists():
            continue
        epochs = list(csv.DictReader(file.open()))
        if epochs:
            axis = axes[1] if setting['reasoning'] else axes[0]
            axis.plot([int(row['epoch']) for row in epochs], [float(row['validation_loss']) for row in epochs], marker='.', color=colors[setting['size']], linestyle='-' if setting['seed'] == 42 else '--')
    for axis, title in zip(axes, ['Answers only: 300 samples, seed 42', 'Reasoning plus answers']):
        axis.set(title=title, xlabel='Epoch', ylabel='Mean validation batch loss')
        axis.grid(alpha=0.2)
    handles = [Line2D([0], [0], color=color, label=f'{size} samples') for size, color in colors.items()]
    handles += [Line2D([0], [0], color='#475569', linestyle=style, label=f'Seed {seed}') for seed, style in [(42, '-'), (0, '--')]]
    figure.legend(handles=handles, loc='lower center', bbox_to_anchor=(0.5, 0.045), ncol=3, frameon=False)
    figure.suptitle('Official CLI validation loss by target format')
    figure.text(0.5, 0.012, 'The target formats differ. Compare losses within each panel.', ha='center', fontsize=10)
    figure.tight_layout(rect=(0, 0.16, 1, 0.94))
    for extension in ['png', 'svg']:
        figure.savefig(directory / f'batch-validation-loss.{extension}', dpi=180)
    plt.close(figure)


if __name__ == '__main__':
    plot(Path(sys.argv[1]).resolve())
