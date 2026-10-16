# Event schema (v1) - the contract between bordercollie and Pet bordercollie

bordercollie decides.
bordercollie expresses.
They communicate through the Pet process's private input pipe.

## Transport

The OpenCode plugin sends each event directly to the running Pet process.
The pipe belongs to the running plugin instance, so the Pet exits when that plugin disconnects.
The Pet queues events only in memory while its renderer starts.
Nothing is replayed after OpenCode exits, and the runtime does not create `~/.bordercollie`.

## Event object

```json
{
  "v": 1,
  "seq": 12,
  "ts": "2026-09-03T14:22:31.004Z",
  "runId": "run-20260903-142120",
  "type": "excursion",
  "status": "block",
  "petState": "refused",
  "tool": "bash",
  "summary": "curl -X POST http://198.51.100.7",
  "reason": "the Judge found this action outside the folder Preference",
  "rule": "judge",
  "detail": {}
}
```

`seq` is monotonic within a run.
`summary` is short and human-readable.
bordercollie shows it in a speech bubble, so keep it under ~60 chars.

## `type` values

| type        | When                                                    | Typical `status`      |
|-------------|---------------------------------------------------------|-----------------------|
| `run`       | Run started, completed normally, or ended                | `start` / `finish` / `end` |
| `protocol`  | Folder Preference loaded - carries it in `detail`       | `ok`                  |
| `thinking`  | The agent started or stopped thinking                   | `ok` / `idle`         |
| `action`    | A tool call was proposed and allowed                    | `allow`               |
| `excursion` | A tool call was proposed and refused                    | `block`               |
| `suspicious`| A tool *result* contained instruction-like text         | `warn`                |
| `toolerror` | A tool *result* came back broken                        | `error`               |
| `claim`     | The agent asserted it finished something                | `open`                |
| `verdict`   | Evidence for a claim was checked                        | `pass` / `fail`       |
| `ask`       | The Judge held a call for the owner, or a completion claim needs a human | `ask`    |

## `petState` values

bordercollie sets `petState` on each event.

The shared Pet animation contract in `events/pet-config.json` maps these states to named animation tracks.

| petState | Animation folder |
|----------|------------------|
| `calm` | `bordercollie-normal` |
| `allowed` | `bordercollie-normal` |
| `asking` | `bordercollie-thinking` |
| `celebrating` | `bordercollie-celebrating` |
| `checking` | `bordercollie-thinking` |
| `denied` | `bordercollie-denied` |
| `drag` | `bordercollie-dragging` |
| `error` | `bordercollie-thinking` |
| `hover` | `bordercollie-hovering` |
| `offline` | `bordercollie-normal` |
| `proving` | `bordercollie-thinking` |
| `refused` | `bordercollie-refused` |
| `rejecting` | `bordercollie-refused` |
| `sleeping` | `bordercollie-denied` |
| `suspicious` | `bordercollie-suspicious` |
| `thinking` | `bordercollie-thinking` |
| `watching` | `bordercollie-normal` |

## Rules

1. bordercollie never imports Pet code. The OpenCode adapter connects bordercollie output to the Pet process, and Pet never imports bordercollie code.
2. bordercollie always sets `petState`, so the pet never has to infer it from `type`.
3. bordercollie **never blocks anything**. It reports what already happened.
4. Silence is the resting state.
   No event means no reaction, and routine allowed actions tick a counter and say nothing apart from a quick nod.
5. `detail` is free-form and may grow; consumers must ignore unknown keys.
