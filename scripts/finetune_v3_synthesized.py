import argparse
import concurrent.futures
from concurrent.futures import ThreadPoolExecutor
import json
import math
import os
import re
import sys
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

if sys.platform == "darwin":
    os.environ.setdefault("ENABLE_PJRT_COMPATIBILITY", "1")

import numpy as np

try:
    from needle.model.checkpoints import read_adapter, write_adapter
    from needle.model.tokenizer import (
        get_tokenizer, BOS_ID, EOS_ID, PAD_ID,
        IM_START, IM_END, THINK_START, THINK_END,
        TOOLS_START, TOOLS_END, TOOL_CALL_START, TOOL_CALL_END,
    )
except ImportError:
    PAD_ID = 0
    EOS_ID = 1
    BOS_ID = 2
    UNK_ID = 3
    IM_START = "<|im_start|>"
    IM_END = "<|im_end|>"
    THINK_START = "<think>"
    THINK_END = "</think>"
    TOOLS_START = "<tools>"
    TOOLS_END = "</tools>"
    TOOL_CALL_START = "<tool_call>"
    TOOL_CALL_END = "</tool_call>"

    def get_tokenizer(vocab_size: int = 8192):
        import sentencepiece as spm
        model_path = os.environ.get("NEEDLE_TOKENIZER_PATH", "analysis/needle-judge-2026-10-09/artifacts/public-tokenizer/tokenizer.model")
        if not os.path.exists(model_path):
            candidates = [
                "/scratch/qnguye19/needle/tokenizer.model",
                "/scratch/qnguye19/needle/tokenizer/tokenizer.model",
                "tokenizer.model",
            ]
            for cand in candidates:
                if os.path.exists(cand):
                    model_path = cand
                    break
        sp = spm.SentencePieceProcessor()
        sp.Load(model_path)
        class LocalTokenizer:
            def __init__(self, processor):
                self.sp = processor
                self.vocab_size = processor.GetPieceSize()
            def encode(self, text: str) -> List[int]:
                return self.sp.Encode(text, out_type=int)
            def decode(self, ids: Sequence[int]) -> str:
                return self.sp.Decode(list(ids))
        return LocalTokenizer(sp)

    def write_adapter(path: str, adapter: Dict[str, Any]) -> None:
        from safetensors.numpy import save_file
        tensors = {}
        for name, value in adapter["lora"].items():
            tensors[f"lora/{name}/A"] = np.ascontiguousarray(value["A"])
            tensors[f"lora/{name}/B"] = np.ascontiguousarray(value["B"])
        metadata = {
            "scale": json.dumps(adapter.get("scale"), default=str),
            "base": json.dumps(adapter.get("base"), default=str),
            "rank": json.dumps(adapter.get("rank"), default=str),
            "seed": json.dumps(adapter.get("seed"), default=str),
        }
        save_file(tensors, str(path), metadata=metadata)

    def read_adapter(path: str) -> Dict[str, Any]:
        from safetensors import safe_open
        from safetensors.numpy import load_file
        with safe_open(str(path), framework="np") as handle:
            metadata = handle.metadata() or {}
        lora = {}
        for name, value in load_file(str(path)).items():
            parts = name.split("/")
            if len(parts) >= 4 and parts[0] == "lora":
                key = "/".join(parts[1:-1])
                matrix = parts[-1]
                lora.setdefault(key, {})[matrix] = value
        return {
            "lora": lora,
            "scale": json.loads(metadata.get("scale", "1.0")),
            "base": json.loads(metadata.get("base", "null")),
            "rank": json.loads(metadata.get("rank", "16")),
            "seed": json.loads(metadata.get("seed", "0")),
        }

ATTENTION_TARGETS = ("q_proj", "k_proj", "v_proj", "gate_proj", "out_proj")
MLP_COND_TARGETS = ("cond_u", "cond_v")
DEFAULT_BASE = "checkpoints/needle3.safetensors"
PREFIX_BOILERPLATE_TOKENS = 8
VERDICT_NAMES = ("approve", "deny", "ask")
VERDICT_INDEX = {name: i for i, name in enumerate(VERDICT_NAMES)}
VERDICT_LEAD_TOKENS = (478, 462, 2150)


def training_rng(seed: int) -> np.random.Generator:
    return np.random.default_rng(int(seed))


def render_example(example: Dict[str, Any]) -> Tuple[str, str]:
    tools = example.get("tools", [])
    tools_json = tools if isinstance(tools, str) else json.dumps(tools, separators=(",", ":"), ensure_ascii=False)
    answers = example.get("answers", example.get("function_calls", []))
    answers_json = answers if isinstance(answers, str) else json.dumps(answers, separators=(",", ":"), ensure_ascii=False)
    reasoning = (example.get("reasoning") or "").strip()
    system = (example.get("system") or "").strip()
    prefix = IM_START + "system\n" + system + IM_END + "\n" if system else ""
    prompt = (
        prefix
        + IM_START
        + "user\n"
        + TOOLS_START
        + tools_json
        + TOOLS_END
        + "\n"
        + example["query"]
        + IM_END
        + "\n"
        + IM_START
        + "assistant\n"
    )
    if reasoning:
        raise ValueError("Direct checker targets cannot include reasoning")
    think = THINK_START + "\n" + THINK_END + "\n"
    target = think + TOOL_CALL_START + answers_json + TOOL_CALL_END + IM_END
    return prompt, target


def compute_class_weights(examples: Sequence[Dict[str, Any]], mode: str = "auto") -> Dict[str, float]:
    if mode == "none":
        return {"approve": 1.0, "deny": 1.0, "ask": 1.0}

    counts: Dict[str, int] = {}
    for example in examples:
        answers = example.get("answers", example.get("function_calls", []))
        if answers and isinstance(answers, list) and isinstance(answers[0], dict):
            name = answers[0].get("name")
            if name:
                counts[name] = counts.get(name, 0) + 1

    total = sum(counts.values())
    num_classes = len(counts)
    if total == 0 or num_classes == 0:
        return {}

    return {cls: total / (num_classes * cnt) for cls, cnt in counts.items()}


def locate_decision_token_span(
    target_ids: Sequence[int],
    decision_ids: Sequence[int],
    prefix_len: int = PREFIX_BOILERPLATE_TOKENS,
) -> Tuple[int, int]:
    span_len = len(decision_ids)
    if span_len == 0:
        return 0, 0
    if len(target_ids) >= prefix_len + span_len:
        if list(target_ids[prefix_len : prefix_len + span_len]) == list(decision_ids):
            return prefix_len, prefix_len + span_len
    for start in range(len(target_ids) - span_len + 1):
        if list(target_ids[start : start + span_len]) == list(decision_ids):
            return start, start + span_len
    return 0, 0


def encode_example(
    tokenizer: Any,
    example: Dict[str, Any],
    max_len: int,
    syntax_weight: float = 1.0,
    decision_weight: float = 16.0,
    normalize_decision_tokens: bool = True,
    class_weights: Optional[Dict[str, float]] = None,
) -> Tuple[List[int], List[float], int, int]:
    prompt, target = render_example(example)
    prompt_ids = tokenizer.encode(prompt)
    target_ids = tokenizer.encode(target)

    answers = example.get("answers", example.get("function_calls", []))
    verdict = (
        answers[0].get("name", "")
        if answers and isinstance(answers, list) and isinstance(answers[0], dict)
        else ""
    )
    decision_ids = tokenizer.encode(verdict) if verdict else []
    class_scale = class_weights.get(verdict, 1.0) if class_weights else 1.0

    start_idx, end_idx = locate_decision_token_span(target_ids, decision_ids, prefix_len=PREFIX_BOILERPLATE_TOKENS)
    decision_token_count = max(1, end_idx - start_idx) if start_idx < end_idx else 1

    per_token_decision_weight = (
        (decision_weight / decision_token_count)
        if normalize_decision_tokens
        else decision_weight
    )

    effective_syntax_weight = syntax_weight * class_scale
    effective_decision_weight = per_token_decision_weight * class_scale

    target_weights: List[float] = []
    for idx in range(len(target_ids)):
        if start_idx <= idx < end_idx:
            target_weights.append(effective_decision_weight)
        else:
            target_weights.append(effective_syntax_weight)
    target_weights.append(effective_syntax_weight)

    ids = [BOS_ID] + prompt_ids + target_ids + [EOS_ID]
    mask = [0.0] * (1 + len(prompt_ids)) + target_weights

    verdict_token_pos = len(prompt_ids) + start_idx
    verdict_target_id = VERDICT_INDEX.get(verdict, 0)

    ids = ids[:max_len]
    mask = mask[:max_len]
    pad = max_len - len(ids)
    return ids + [PAD_ID] * pad, mask + [0.0] * pad, min(verdict_token_pos, max_len - 2), verdict_target_id


def from_chat(example: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    messages = example.get("messages")
    if not isinstance(messages, list) or "query" in example:
        return None
    turns = [m for m in messages if m.get("role") != "system"]
    if len(turns) != 2 or turns[0].get("role") != "user" or turns[1].get("role") != "assistant":
        return None
    answers = []
    for call in turns[1].get("tool_calls") or []:
        function = call.get("function") or call
        arguments = function.get("arguments", {})
        if isinstance(arguments, str):
            arguments = json.loads(arguments) if arguments.strip() else {}
        answers.append({"name": function.get("name"), "arguments": arguments})
    tools = [t.get("function", t) if isinstance(t, dict) else t for t in example.get("tools") or []]
    out = {"query": turns[0].get("content") or "", "tools": tools, "answers": answers}
    system = [m.get("content") for m in messages if m.get("role") == "system"]
    if system and system[0]:
        out["system"] = system[0]
    return out


def read_examples(path: str, report: bool = False):
    skipped = 0
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            example = json.loads(line)
            if "query" not in example:
                example = from_chat(example)
            if example is None:
                skipped += 1
                continue
            yield example
    if skipped and report:
        print(f"  skipped {skipped} line(s) that are neither query/answers nor single-turn chat format", flush=True)


def fit_max_len(path: str, tokenizer: Any, cap: int) -> int:
    longest = 0
    for example in read_examples(path):
        prompt, target = render_example(example)
        longest = max(longest, len(tokenizer.encode(prompt)) + len(tokenizer.encode(target)) + 2)
    bucket = 128
    while bucket < min(longest, cap):
        bucket *= 2
    return min(bucket, cap)


def load_jsonl(
    path: str,
    tokenizer: Any,
    max_len: int,
    syntax_weight: float = 1.0,
    decision_weight: float = 16.0,
    normalize_decision_tokens: bool = True,
    class_balance: str = "auto",
    preset_class_weights: Optional[Dict[str, float]] = None,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, Dict[str, float]]:
    examples = list(read_examples(path, report=True))
    if not examples:
        return np.empty((0, max_len), np.int32), np.empty((0, max_len), np.float32), np.empty(0, np.int32), np.empty(0, np.int32), {}

    if preset_class_weights is not None:
        class_weights = preset_class_weights
    else:
        class_weights = compute_class_weights(examples, mode=class_balance)

    seqs, masks, positions, targets = [], [], [], []
    for example in examples:
        ids, mask, pos, target_id = encode_example(
            tokenizer,
            example,
            max_len,
            syntax_weight=syntax_weight,
            decision_weight=decision_weight,
            normalize_decision_tokens=normalize_decision_tokens,
            class_weights=class_weights,
        )
        seqs.append(ids)
        masks.append(mask)
        positions.append(pos)
        targets.append(target_id)

    return np.array(seqs, np.int32), np.array(masks, np.float32), np.array(positions, np.int32), np.array(targets, np.int32), class_weights


def rung(params: Any, config: Any, layers: Optional[int]):
    try:
        from needle.model.architecture import ladder_config, ladder_slice
    except ImportError:
        from .architecture import ladder_config, ladder_slice

    fields = dict(config.__dict__)
    fields.update(ladder_depths=(), ladder_sample=False, ladder_widths=())
    config = type(config)(**fields)
    if not layers or layers == config.num_layers:
        return params, config
    if not 2 <= layers < config.num_layers:
        raise ValueError(f"--layers must be in [2, {config.num_layers}], got {layers}")
    return ladder_slice(params, config, layers), ladder_config(config, layers)


def lora_target_paths(params: Any, include_mlp_cond: bool = True) -> List[Tuple[str, ...]]:
    import jax.numpy as jnp
    from flax.traverse_util import flatten_dict
    flat = flatten_dict(params)
    paths: List[Tuple[str, ...]] = []

    for path, weight in flat.items():
        if float(jnp.max(jnp.abs(weight))) <= 1e-6:
            continue

        if (
            path[-1] == "kernel"
            and "stack" in path
            and "layers" in path
            and "self_attn" in path
            and any(target in path for target in ATTENTION_TARGETS)
        ):
            paths.append(path)
            continue

        if (
            include_mlp_cond
            and "stack" in path
            and "layers" in path
            and "hadamard_mlp" in path
            and path[-1] in MLP_COND_TARGETS
        ):
            paths.append(path)
            continue

    return sorted(paths, key=lambda item: "/".join(item))


def init_lora(
    params: Any,
    paths: Sequence[Tuple[str, ...]],
    rank: int,
    key: Any,
    cond_rank: int = 8,
) -> Dict[Tuple[str, ...], Dict[str, Any]]:
    import jax
    import jax.numpy as jnp
    from flax.traverse_util import flatten_dict
    flat = flatten_dict(params)
    lora: Dict[Tuple[str, ...], Dict[str, Any]] = {}
    current_key = key

    for path in paths:
        weight = flat[path]
        in_dim = weight.shape[-2]
        out_dim = weight.shape[-1]
        lead = weight.shape[:-2]

        is_cond = "hadamard_mlp" in path and path[-1] in MLP_COND_TARGETS
        target_rank = min(cond_rank if is_cond else rank, in_dim, out_dim)

        current_key, subkey = jax.random.split(current_key)
        lora[path] = {
            "A": jax.random.normal(subkey, lead + (in_dim, target_rank), jnp.float32) / target_rank,
            "B": jnp.zeros(lead + (target_rank, out_dim), jnp.float32),
        }
    return lora


def merge_lora(params: Any, lora: Dict[Tuple[str, ...], Dict[str, Any]], scale: float) -> Any:
    import jax.numpy as jnp
    from flax.traverse_util import flatten_dict, unflatten_dict
    flat = dict(flatten_dict(params))
    for path, adapter in lora.items():
        delta = scale * jnp.matmul(adapter["A"], adapter["B"])
        flat[path] = flat[path] + delta.astype(flat[path].dtype)
    return unflatten_dict(flat)


def calls_of(text: str) -> Optional[List[Tuple[str, str]]]:
    if TOOL_CALL_START not in text:
        return []
    body = text.split(TOOL_CALL_START, 1)[1].split(TOOL_CALL_END)[0]
    try:
        calls = json.loads(body)
    except json.JSONDecodeError:
        return None
    if not isinstance(calls, list):
        return None
    return [
        (str(c.get("name")), json.dumps(c.get("arguments") or {}, sort_keys=True))
        for c in calls
        if isinstance(c, dict)
    ]


def score_quantised(
    model: Any,
    params: Any,
    lora: Dict[Tuple[str, ...], Dict[str, Any]],
    scale: float,
    tokenizer: Any,
    data_path: str,
    n_val: int,
    rng_seed: int = 0,
) -> Tuple[int, int]:
    from needle.model.run import generate
    from needle.model.quantize import cq_ste_params, WEIGHT_BITS

    examples = list(read_examples(data_path))
    if not examples:
        return 0, 0
    order = np.random.default_rng(rng_seed).permutation(len(examples))
    held = [examples[i] for i in order[:n_val]]
    merged = cq_ste_params(merge_lora(params, lora, scale), WEIGHT_BITS)
    correct = 0
    for example in held:
        prompt, _ = render_example({**example, "answers": []})
        text = generate(model, merged, tokenizer, prompt, max_new_tokens=96, temperature=0.0, stream=False)
        want = calls_of(
            TOOL_CALL_START
            + json.dumps(example.get("answers", []), separators=(",", ":"))
            + TOOL_CALL_END
        )
        correct += calls_of(text) == want
    return correct, len(held)


def audit_dataset_policies(path: str) -> None:
    print(f"Auditing policy distribution in: {path}")
    counts: Dict[str, int] = {}
    categories: Dict[str, int] = {
        "destructive": 0,
        "exfiltration": 0,
        "confirmation": 0,
        "permitted": 0,
        "other": 0,
    }

    with open(path, encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            item = json.loads(line)
            query = item.get("query", "").lower()
            answers = item.get("answers", item.get("function_calls", []))
            v = answers[0].get("name", "unknown") if answers else "unknown"
            counts[v] = counts.get(v, 0) + 1

            if "prohibit" in query or "never" in query or "disallowed" in query:
                categories["destructive"] += 1
            elif "exfiltrat" in query or "off the machine" in query:
                categories["exfiltration"] += 1
            elif "confirm" in query or "require" in query or "unclear" in query:
                categories["confirmation"] += 1
            elif "permit" in query or "allow" in query:
                categories["permitted"] += 1
            else:
                categories["other"] += 1

    total = sum(counts.values())
    print(f"Total samples: {total}")
    for k, v in counts.items():
        print(f"  Verdict {k}: {v} ({v / total * 100:.2f}%)")
    print("Semantic policy coverage:")
    for k, v in categories.items():
        print(f"  Category {k}: {v} ({v / total * 100:.2f}%)")


def finetune_local(args: argparse.Namespace, progress: Optional[Any] = None) -> None:
    import jax
    import jax.numpy as jnp
    import optax
    from needle.model.run import load_checkpoint
    from needle.model.architecture import SimpleAttentionNetwork
    from needle.model.quantize import configure_deploy, cq_ste_params, WEIGHT_BITS

    def emit(msg: str) -> None:
        print(msg, flush=True)
        if progress:
            progress(msg)

    base_path = args.checkpoint or DEFAULT_BASE
    data_path = args.jsonl_path

    syntax_weight = 0.0 if args.strict_decision_mask else float(getattr(args, "syntax_weight", 1.0))
    decision_weight = float(getattr(args, "decision_weight", 16.0))
    normalize_decision_tokens = not getattr(args, "no_normalize_decision_tokens", False)
    class_balance = getattr(args, "class_balance", "auto")
    focal_gamma = float(getattr(args, "focal_gamma", 0.0))
    include_mlp_cond = not getattr(args, "no_mlp_cond", False)
    risk_weight = float(getattr(args, "risk_weight", 1.0))

    params, config = load_checkpoint(base_path)
    config.dtype = "float32"
    params = jax.tree.map(lambda a: np.asarray(a).astype(np.float32), params)
    backend = jax.default_backend().lower()
    if backend == "metal":
        config.flash = False
        config.remat = False
        config.scan_unroll = config.num_layers
    params = jax.device_put(params)
    emit(f"  {'backend':<9} {backend}  float32")
    emit(f"  {'depth':<9} {config.num_layers} layers")

    tokenizer = get_tokenizer(config.vocab_size)
    max_len = fit_max_len(data_path, tokenizer, args.max_len)
    seqs, masks, positions, targets, class_weights = load_jsonl(
        data_path,
        tokenizer,
        max_len,
        syntax_weight=syntax_weight,
        decision_weight=decision_weight,
        normalize_decision_tokens=normalize_decision_tokens,
        class_balance=class_balance,
    )
    if len(seqs) == 0:
        raise SystemExit("no usable examples in " + data_path)

    weights_summary = ", ".join(f"{k}: {v:.3f}" for k, v in class_weights.items())
    emit(f"  {'data':<9} {len(seqs)} examples  seq_len {max_len}  cap {args.max_len}")
    emit(f"  {'weighting':<9} dec_weight={decision_weight:.1f} syn_weight={syntax_weight:.1f} norm_tokens={normalize_decision_tokens}")
    emit(f"  {'classes':<9} {class_balance} [{weights_summary}]")
    emit(f"  {'capacity':<9} rank={args.lora_rank} alpha={args.lora_alpha} mlp_cond={include_mlp_cond}")
    emit(f"  {'asymmetric':<9} risk_weight={risk_weight:.2f} (10x false approval penalty)")

    model = SimpleAttentionNetwork(config)
    configure_deploy(act_bits=getattr(config, "act_bits", 8), kv_bits=getattr(config, "kv_bits", 8))
    emit(f"  {'numerics':<9} CQ W{WEIGHT_BITS} STE + A8 (matches export)")

    paths = lora_target_paths(params, include_mlp_cond=include_mlp_cond)
    scale = args.lora_alpha / args.lora_rank
    seed = int(getattr(args, "seed", 0))
    rng = training_rng(seed)
    lora = init_lora(params, paths, args.lora_rank, jax.random.PRNGKey(seed), cond_rank=8)
    emit(f"  {'lora':<9} rank {args.lora_rank}  alpha {args.lora_alpha:g}  {len(paths)} weight groups")

    n_val = min(int(len(seqs) * getattr(args, "val_split", 0.1)), len(seqs) - 1)
    if n_val > 0:
        order = rng.permutation(len(seqs))
        seqs, masks, positions, targets = seqs[order], masks[order], positions[order], targets[order]
        val_seqs, val_masks, val_pos, val_targs = seqs[:n_val], masks[:n_val], positions[:n_val], targets[:n_val]
        seqs, masks, positions, targets = seqs[n_val:], masks[n_val:], positions[n_val:], targets[n_val:]
        emit(f"  {'holdout':<9} {n_val} examples for validation")

    batch, count = args.batch_size, len(seqs)
    steps_per_epoch = -(-count // batch)
    total_steps = args.epochs * steps_per_epoch
    warmup = min(max(1, total_steps // 20), total_steps - 1)
    schedule = optax.warmup_cosine_decay_schedule(
        init_value=0.0,
        peak_value=args.lr,
        warmup_steps=warmup,
        decay_steps=total_steps,
    )
    optimizer = optax.chain(optax.clip_by_global_norm(1.0), optax.adamw(schedule))
    opt_state = optimizer.init(lora)
    emit(f"  {'schedule':<9} {total_steps} steps  warmup {warmup}  cosine decay  clip 1.0  (compiling...)")

    cost_matrix = jnp.array([
        [0.0, 1.0, 0.5],
        [10.0, 0.0, 1.0],
        [5.0, 1.0, 0.0],
    ], dtype=jnp.float32)
    verdict_tokens_jnp = jnp.array(VERDICT_LEAD_TOKENS, dtype=jnp.int32)

    def loss_fn(adapter_weights: Any, token_ids: jnp.ndarray, token_masks: jnp.ndarray, pos: jnp.ndarray, targs: jnp.ndarray) -> jnp.ndarray:
        merged = cq_ste_params(merge_lora(params, adapter_weights, scale), WEIGHT_BITS)
        logits = model.apply({"params": merged}, token_ids, quant=True)
        logits_sliced = logits[:, :-1]
        targets_sliced = token_ids[:, 1:]
        mask_sliced = token_masks[:, 1:]
        ce = optax.softmax_cross_entropy_with_integer_labels(logits_sliced, targets_sliced)

        if focal_gamma > 0.0:
            pt = jnp.exp(-ce)
            focal_factor = (1.0 - pt) ** focal_gamma
            weighted_ce = ce * focal_factor * mask_sliced
        else:
            weighted_ce = ce * mask_sliced

        base_loss = weighted_ce.sum() / jnp.maximum(mask_sliced.sum(), 1.0)

        if risk_weight > 0.0:
            batch_size = token_ids.shape[0]
            batch_idx = jnp.arange(batch_size)
            decision_logits = logits_sliced[batch_idx, pos][:, verdict_tokens_jnp]
            probs = jax.nn.softmax(decision_logits, axis=-1)
            sample_costs = cost_matrix[targs]
            expected_risk = jnp.sum(probs * sample_costs, axis=-1)
            mean_risk = jnp.mean(expected_risk)
            return base_loss + risk_weight * mean_risk

        return base_loss

    @jax.jit
    def train_step(adapter_weights: Any, state: Any, token_ids: jnp.ndarray, token_masks: jnp.ndarray, pos: jnp.ndarray, targs: jnp.ndarray):
        loss_val, grads = jax.value_and_grad(loss_fn)(adapter_weights, token_ids, token_masks, pos, targs)
        updates, state = optimizer.update(grads, state, adapter_weights)
        return optax.apply_updates(adapter_weights, updates), state, loss_val

    eval_step = jax.jit(loss_fn)

    every = max(1, total_steps // 50)
    step_i = 0
    for epoch in range(args.epochs):
        order = rng.permutation(count)
        last_train_loss = 0.0
        for start in range(0, count, batch):
            idx = order[start : start + batch]
            lora, opt_state, loss_val = train_step(
                lora,
                opt_state,
                jnp.asarray(seqs[idx]),
                jnp.asarray(masks[idx]),
                jnp.asarray(positions[idx]),
                jnp.asarray(targets[idx]),
            )
            last_train_loss = float(loss_val)
            step_i += 1
            if step_i % every == 0:
                emit(f"  {'step':<9} {step_i}/{total_steps}  loss {last_train_loss:.4f}")

        if n_val > 0:
            val_losses = [
                float(
                    eval_step(
                        lora,
                        jnp.asarray(val_seqs[i : i + batch]),
                        jnp.asarray(val_masks[i : i + batch]),
                        jnp.asarray(val_pos[i : i + batch]),
                        jnp.asarray(val_targs[i : i + batch]),
                    )
                )
                for i in range(0, n_val, batch)
            ]
            val_mean = float(np.mean(val_losses))
            emit(f"  {'epoch':<9} {epoch + 1}/{args.epochs}  loss {last_train_loss:.4f}  val {val_mean:.4f}")
        else:
            emit(f"  {'epoch':<9} {epoch + 1}/{args.epochs}  loss {last_train_loss:.4f}")

    if n_val > 0 and getattr(args, "score", True):
        correct, total = score_quantised(model, params, lora, scale, tokenizer, data_path, n_val, rng_seed=seed)
        if total:
            emit(f"  {'accuracy':<9} {correct}/{total} held-out calls exact, scored on W{WEIGHT_BITS} weights")

    os.makedirs(args.checkpoint_dir, exist_ok=True)
    out_path = args.out or os.path.join(args.checkpoint_dir, "needle_lora.safetensors")
    write_adapter(
        out_path,
        {
            "lora": {
                "/".join(p): {"A": np.asarray(v["A"]), "B": np.asarray(v["B"])}
                for p, v in lora.items()
            },
            "scale": float(scale),
            "base": base_path,
            "rank": args.lora_rank,
            "seed": seed,
        },
    )
    print(f"  {'adapter':<9} {out_path}", flush=True)
    print(f"  {'next':<9} needle build {base_path} --lora {out_path}", flush=True)


def build_main(args: argparse.Namespace) -> None:
    import shutil
    import jax.numpy as jnp
    from needle.agent import fetch
    from needle.model.run import load_checkpoint
    from needle.model.architecture import ConfidenceHead, effective_kv_window
    from needle.model.export import read_layers, read_tokenizer_blob, write_export
    from needle.model.quantize import WEIGHT_BITS

    base_archive = getattr(args, "base_archive", None)
    if not base_archive or not os.path.exists(base_archive):
        candidates = [
            "/scratch/qnguye19/needle/needle3.cact",
            "checkpoints/needle3.cact",
            "needle3.cact",
        ]
        for c in candidates:
            if os.path.exists(c):
                base_archive = c
                break
    if not base_archive or not os.path.exists(base_archive):
        base_archive = fetch.fetch_weights(3, force=True)
    print(f"  {'base':<9} {base_archive}  {os.path.getsize(base_archive) / 1e6:.2f} MB")
    platform = getattr(args, "platform", None)
    layers = getattr(args, "layers", None)
    folder = None
    if platform:
        folder = os.path.abspath(args.out or platform)
        for path in fetch.download_platform(platform, os.path.dirname(folder), generation=3, dest=folder):
            print(f"  {'engine':<9} {path}  {os.path.getsize(path) / 1e6:.2f} MB")
        out = os.path.join(folder, fetch.base_weights(3))
    else:
        out = args.out

    if not args.lora and (not layers or layers == read_layers(base_archive)):
        if not out:
            raise SystemExit("pass --out <archive.cact>, or --platform to build a runnable folder")
        shutil.copyfile(base_archive, out)
        print(f"  {'wrote':<9} {out}  {os.path.getsize(out) / 1e6:.2f} MB  the published base archive")
    else:
        adapter = read_adapter(args.lora) if args.lora else None
        checkpoint = args.checkpoint
        if not checkpoint and adapter and adapter.get("base") and os.path.exists(adapter["base"]):
            checkpoint = adapter["base"]
        checkpoint = checkpoint or DEFAULT_BASE
        params, config, _ = load_checkpoint(checkpoint, return_run=True)
        if args.lora:
            lora = {
                tuple(key.split("/")): {"A": jnp.asarray(v["A"]), "B": jnp.asarray(v["B"])}
                for key, v in adapter["lora"].items()
            }
            params = merge_lora(params, lora, adapter["scale"])
            print(f"  {'merged':<9} {len(lora)} weight groups  {args.lora}")
            if ConfidenceHead.key in params:
                params = {k: v for k, v in params.items() if k != ConfidenceHead.key}
                print(f"  {'dropped':<9} confidence head")
        params, config = rung(params, config, layers)
        out = out or (os.path.splitext(os.path.basename(checkpoint))[0] + ".cact")
        info = write_export(
            params,
            config,
            out,
            bits=WEIGHT_BITS,
            tokenizer=read_tokenizer_blob(base_archive),
            kv_window=effective_kv_window(config),
        )
        print(f"  {'wrote':<9} {info['path']}  {info['bytes'] / 1e6:.2f} MB  {info['tensors']} tensors  W{WEIGHT_BITS}A8")


def main() -> None:
    parser = argparse.ArgumentParser(description="V3 Synthesized Fine-Tuning Pipeline for Needle 3")
    subparsers = parser.add_subparsers(dest="command")

    audit_parser = subparsers.add_parser("audit", help="Audit dataset policy distributions")
    audit_parser.add_argument("path", help="Path to JSONL dataset")

    train_parser = subparsers.add_parser("train", help="Run fine-tuning")
    train_parser.add_argument("jsonl_path", help="Training dataset JSONL")
    train_parser.add_argument("--checkpoint", default=DEFAULT_BASE)
    train_parser.add_argument("--epochs", type=int, default=10)
    train_parser.add_argument("--batch-size", type=int, default=20)
    train_parser.add_argument("--lr", type=float, default=1e-4)
    train_parser.add_argument("--lora-rank", type=int, default=64)
    train_parser.add_argument("--lora-alpha", type=float, default=128.0)
    train_parser.add_argument("--max-len", type=int, default=1024)
    train_parser.add_argument("--val-split", type=float, default=0.1)
    train_parser.add_argument("--seed", type=int, default=0)
    train_parser.add_argument("--checkpoint-dir", default="checkpoints")
    train_parser.add_argument("--out", default=None)
    train_parser.add_argument("--decision-weight", type=float, default=16.0)
    train_parser.add_argument("--syntax-weight", type=float, default=1.0)
    train_parser.add_argument("--strict-decision-mask", action="store_true")
    train_parser.add_argument("--no-normalize-decision-tokens", action="store_true")
    train_parser.add_argument("--class-balance", default="auto", choices=["auto", "none"])
    train_parser.add_argument("--focal-gamma", type=float, default=0.0)
    train_parser.add_argument("--no-mlp-cond", action="store_true")
    train_parser.add_argument("--risk-weight", type=float, default=1.0)
    train_parser.add_argument("--no-score", dest="score", action="store_false", default=True)

    build_parser = subparsers.add_parser("build", help="Build .cact archive from adapter")
    build_parser.add_argument("--checkpoint", default=DEFAULT_BASE)
    build_parser.add_argument("--lora", required=True)
    build_parser.add_argument("--base-archive", default=None)
    build_parser.add_argument("--layers", type=int, default=20)
    build_parser.add_argument("--platform", default=None)
    build_parser.add_argument("--out", default=None)

    args = parser.parse_args()
    if args.command == "audit":
        audit_dataset_policies(args.path)
    elif args.command == "train":
        finetune_local(args)
    elif args.command == "build":
        build_main(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
