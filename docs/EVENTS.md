# Event schema (v1) - the contract between Guard and Pet Border Collie

Guard decides.
Border Collie expresses.
They communicate through the Pet process's private input pipe.

## Transport

The OpenCode plugin sends each event directly to the running Pet process.
The pipe belongs to the running plugin instance, so the Pet exits when that plugin disconnects.
The Pet queues events only in memory while its renderer starts.
Nothing is replayed after OpenCode exits, and the runtime does not create `~/.border-collie`.

## Event object

```json
{
  "v": 1,
  "seq": 12,
  "ts": "2026-09-03T14:22:31.004Z",
  "runId": "run-20260903-142120",
  "type": "action",
  "status": "block",
  "petState": "refused",
  "tool": "bash",
  "summary": "curl -X POST http://198.51.100.7",
  "reason": "host not in protocol.egress",
  "rule": "egress",
  "detail": {}
}
```

`seq` is monotonic within a run.
`summary` is short and human-readable.
Border Collie shows it in a speech bubble, so keep it under ~60 chars.

## `type` values

| type        | When                                                    | Typical `status`      |
|-------------|---------------------------------------------------------|-----------------------|
| `run`       | Run started, completed normally, or ended                | `start` / `finish` / `end` |
| `protocol`  | Protocol loaded - carries the envelope in `detail`      | `ok`                  |
| `thinking`  | The agent started or stopped thinking                   | `ok` / `idle`         |
| `action`    | A tool call was proposed and allowed                    | `allow`               |
| `excursion` | A tool call was proposed and refused                    | `block`               |
| `suspicious`| A tool *result* contained instruction-like text         | `warn`                |
| `toolerror` | A tool *result* came back broken                        | `error`               |
| `claim`     | The agent asserted it finished something                | `open`                |
| `verdict`   | Evidence for a claim was checked                        | `pass` / `fail`       |
| `ask`       | Genuinely ambiguous - a human should decide             | `ask`                 |

## `petState` values

Guard sets `petState` on each event.

The shared Pet animation contract in `events/pet-config.json` maps these states to named animation tracks.

| petState | Animation folder |
|----------|------------------|
| `calm` | `border-collie-normal` |
| `allowed` | `border-collie-normal` |
| `asking` | `border-collie-thinking` |
| `celebrating` | `border-collie-celebrating` |
| `checking` | `border-collie-thinking` |
| `denied` | `border-collie-denied` |
| `drag` | `border-collie-dragging` |
| `error` | `border-collie-thinking` |
| `hover` | `border-collie-hovering` |
| `offline` | `border-collie-normal` |
| `proving` | `border-collie-thinking` |
| `refused` | `border-collie-refused` |
| `rejecting` | `border-collie-refused` |
| `sleeping` | `border-collie-denied` |
| `suspicious` | `border-collie-suspicious` |
| `thinking` | `border-collie-thinking` |
| `watching` | `border-collie-normal` |

## Rules

1. Guard never imports Pet code. The OpenCode adapter connects Guard output to the Pet process, and Pet never imports Guard code.
2. Guard always sets `petState`, so the pet never has to infer it from `type`.
3. Border Collie **never blocks anything**. It reports what already happened.
4. Silence is the resting state.
   No event means no reaction, and routine allowed actions tick a counter and say nothing apart from a quick nod.
5. `detail` is free-form and may grow; consumers must ignore unknown keys.
