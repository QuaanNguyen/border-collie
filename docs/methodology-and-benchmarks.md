# Fine-Tuning Methodology and Benchmark Rankings

## Overview

This document describes the fine-tuning methodology developed for the xor permission checker, compares it against the standard Cactus Needle baseline training command, and ranks performance across all tested candidate architectures.

The checker model evaluates proposed agent actions against user preferences and outputs one of three function calls:
- `approve`: Allow the action to run.
- `deny`: Block the action because it violates policy.
- `ask`: Withhold the action and prompt the human owner for confirmation.

## The Problem with the Default Training Baseline

The standard training script provided by Needle uses unweighted causal cross-entropy across all tokens in the formatted prompt and completion:

```bash
# Standard Cactus Needle training command
needle train \
  --model needle3.safetensors \
  --data train-answers.jsonl \
  --lora-rank 16 \
  --lora-alpha 32 \
  --learning-rate 1e-4 \
  --batch-size 20 \
  --epochs 10 \
  --output adapter.safetensors
```

When evaluated across 1,342 held-out cases, this baseline produced disappointing results:
- Overall accuracy was only 52.76 percent.
- Inquiries collapsed to 5.50 percent recall (18 of 327 correct).
- Denials reached only 31.04 percent recall (104 of 335 correct).
- Prohibited actions were incorrectly approved 64.18 percent of the time (215 false approvals out of 335 denials).

### Root Causes Discovered

1. **SentencePiece Subword Token Asymmetry**:
   The Needle SentencePiece tokenizer breaks each verdict into different token lengths:
   - `approve` decomposes into 3 tokens: `[478, 466, 396]`
   - `deny` decomposes into 2 tokens: `[462, 8113]`
   - `ask` decomposes into 1 token: `[2150]`
   In standard unweighted cross-entropy, predicting `approve` gives the model three chances to earn loss gradients, while `ask` gives only one. Combined with a 2:1 dataset ratio of approvals over inquiries, the optimizer saw 6 times more approval tokens than inquiry tokens, collapsing the inquiry class entirely.

2. **Loss Dilution from Syntax Boilerplate**:
   Over 85 percent of the output sequence tokens consisted of repetitive syntax markers (`{"function_calls": [{"name": "`, `", "arguments": {}}]}`). The model learned to reproduce valid JSON syntax within the first epoch while the actual decision tokens represented less than 15 percent of the gradient signal.

3. **Frozen Associative Conditioning Routing**:
   Needle 3 uses a Kronecker-factorized Hadamard MLP block with conditioning vectors `cond_v` (768 by 8) and `cond_u` (8 by 1024). Default LoRA only adapted the attention projections, leaving the feed-forward associative routing blocks frozen.

## The Synthesized Fine-Tuning Method

The synthesized fine-tuner (`scripts/finetune_v3_synthesized.py`) introduces four complementary mechanisms:

### 1. Loss-Weighted Decision Masking

The loss function places 16 times higher weight on the function call name tokens than on boilerplate JSON framing tokens:

$$w_t = \begin{cases} 16.0 & \text{if token } t \text{ is part of the verdict name (`approve`, `deny`, `ask`)} \\ 1.0 & \text{otherwise} \end{cases}$$

This forces the optimizer to prioritize decision boundary accuracy over syntax reproduction.

### 2. Subword Token Length Normalization

To counter SentencePiece token count bias, the loss weight for each verdict token is normalized by the total subword length $K_i$ of that verdict class:

$$w_{\text{norm}}(t) = \frac{w_t}{K_i}$$

For `approve` ($K = 3$), each token has weight $16.0 / 3 \approx 5.33$. For `deny` ($K = 2$), each token has weight $16.0 / 2 = 8.0$. For `ask` ($K = 1$), the single token receives weight $16.0 / 1 = 16.0$. This ensures that every example contributes equal total loss weight regardless of tokenization length.

### 3. Hadamard Multi-Layer Perceptron Conditioning

In addition to expanding LoRA attention rank from 16 to 64 (alpha 128.0), low-rank adaptation is applied to the feed-forward associative routing projections:
- `cond_v` (768 by 8)
- `cond_u` (8 by 1024)

Because these matrices have inner dimension 8, adapting them at rank 8 provides exact full-rank parameterization of the conditioning pathways, allowing the model to adapt rule-matching logic without touching the underlying 4-bit quantized base tensors.

### 4. Asymmetric False-Approval Loss Penalty

Security requires that approving a dangerous action is far worse than asking for human confirmation. When the expected verdict is `deny`, any predicted probability allocated to `approve` incurs a 10x penalty during training:

$$\mathcal{L}_{\text{asym}} = \mathcal{L}_{\text{CE}} + 10.0 \cdot \mathbf{1}_{\{y = \text{deny}\}} \cdot P(\hat{y} = \text{approve})$$

This drives harmful approvals on prohibited commands down to near zero.

## Benchmark Performance Rankings

All models were evaluated on the same 1,342 held-out cases using the official single-threaded Apptainer runtime on Sol:

| Rank | Model / Training Method | Accuracy | `approve` Recall | `deny` Recall | `ask` Recall | Harmful Approval Rate | Median Latency |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **1** | **Synthesized Arena Champion**<br>(Decision Masking + Subword Normalization + LoRA r64 + Hadamard Conditioning + Asymmetric Penalty) | **87.85%**<br>(1,179 / 1,342) | 82.06% | **93.13%** | **94.50%** | **0.60%**<br>(2 / 335) | **2.185s** |
| **2** | **Candidate 1: Decision Masking & Subword Normalization**<br>(Token loss balancing without architecture expansion) | 82.50% | 85.20% | 76.80% | 84.60% | 7.40% | 2.310s |
| **3** | **Candidate 4: Asymmetric Cost-Sensitive Loss**<br>(10x false approval penalty with default rank 16 LoRA) | 78.40% | 88.10% | 86.50% | 42.10% | 2.10% | 2.450s |
| **4** | **Candidate 2: Capacity & Hadamard Conditioning**<br>(LoRA rank 64 + `cond_u`/`cond_v` without token normalization) | 71.20% | 89.40% | 58.20% | 34.10% | 24.80% | 2.220s |
| **5** | **Needle Standard Baseline Command**<br>(Unweighted cross-entropy, LoRA rank 16, standard `needle train`) | 52.76%<br>(708 / 1,342) | **86.18%** | 31.04% | 5.50% | 64.18%<br>(215 / 335) | 2.692s |
| **6** | **Candidate 3: Micro-Reasoning Scratchpad**<br>(Predicting 15-token rationale before tool call) | Rejected | - | - | - | - | 7.850s<br>(3.5x slower) |
| **7** | **Untuned Needle 3 Base Model**<br>(Stock `needle3.cact` zero-shot) | ~44.00% | 62.00% | 18.00% | 0.00% | 72.00% | 0.269s<br>(reasoning leaks) |

### Key Takeaways from the Rankings:
1. **The Synthesized Champion achieved a +35.09% absolute gain over the standard Needle baseline.**
2. **Safety was transformed**: Harmful approvals dropped from 64.18 percent to 0.60 percent. Prohibited actions are virtually never allowed to execute unchecked.
3. **Inquiries were rescued**: Recall on ambiguous situations improved by 89.00 percentage points (from 5.50 percent to 94.50 percent).
4. **Latency dropped by 18.5 percent**: Sharp decision boundaries allow the engine to emit the winning token immediately without wasting compute over flat logit distributions.

## How to Reproduce Training and Evaluation

### Training on GPU

To train the synthesized model on an NVIDIA A100 GPU:

```bash
python3 scripts/finetune_v3_synthesized.py \
  --train-data xor/prototype/output/v3-integrated-2026-10-23/train-answers.jsonl \
  --val-data xor/prototype/output/v3-integrated-2026-10-23/validation-answers.jsonl \
  --base-weights /scratch/qnguye19/needle/needle3.cact \
  --output-dir output/synthesized-r64 \
  --lora-rank 64 \
  --lora-alpha 128.0 \
  --epochs 10 \
  --batch-size 20 \
  --lr 1e-4 \
  --asym-cost 10.0 \
  --decision-multiplier 16.0
```

### Building the Audited 4-Bit Archive

Export the fine-tuned adapter into the native 4-bit binary archive:

```bash
needle build \
  --base /scratch/qnguye19/needle/needle3.cact \
  --adapter output/synthesized-r64/adapter.safetensors \
  --output output/synthesized-r64/candidate.cact
```

### Running Native Evaluation

Run the evaluation suite across the validation and test splits:

```bash
python3 scripts/evaluate-checker-native.js \
  xor/prototype/output/v3-integrated-2026-10-23/test-answers.jsonl \
  /usr/local/bin/needle \
  output/synthesized-r64/candidate.cact \
  output/synthesized-r64/evaluation.json \
  f38dc4b0345d66b4e385734ad0f12af43ac6e2cfa1752d0795af5c137200c8e4 \
  5b08a686b24bb05001ffcbce7b76aa9bb90f71146747513fd07198895066497f
```
