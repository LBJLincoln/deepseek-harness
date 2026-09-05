# @deepseek-ai/dsh-trajectories

English | [中文](README.zh.md)

Trajectory export: persisted sessions folded into `dsh-trajectory/1` records, one JSON line each, with the chat-format message list a trainer's template consumes, the reward a certificate decided, and the components that were in play. Export reads through the session persistence seam and writes no session event. The [trajectory-export Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-trajectory-export-and-environment-registry.md) owns the design rationale.

## Config

```yaml
- id: persistence
  name: '@deepseek-ai/dsh-session-persistence-jsonl'
  config:
    root: './.sessions'
- id: trajectories
  name: '@deepseek-ai/dsh-trajectories'
```

The service takes no configuration and requires a session persistence backend.

## Service contract

`ctx.trajectories.export({ sessions?, sink, rewardedOnly? })` folds each named session (or every persisted session when `sessions` is absent) through `ctx.sessionPersistence.inspect()` and writes `JSON.stringify(trajectory) + '\n'` to `sink.write()`; a session that cannot be read or folded is added to `skipped` with its reason and the export continues; `rewardedOnly: true` withholds trajectories whose reward outcome is not `1` and counts them as `filtered`. The sink is closed exactly once, after the last write or after a failure. The report carries `sessions`, `exported`, `rewarded`, `filtered`, and `skipped`. `jsonlFileSink(path)` is the shipped file sink; it truncates the file on first use.

`foldTrajectory(meta, events)` is the pure projection behind the service and is exported for tests and offline tools. It is deterministic for the same inputs.

## Record format `dsh-trajectory/1`

| Field | Content |
|---|---|
| `id`, `source` | Session id; creation time, working directory, parent session, and the agent preset the log last selected |
| `config`, `system`, `tools` | Call configuration, rendered system prompt, and tool schemas of the last `request/header` |
| `messages` | Surface messages in model-visible order after compaction replacements: `user`, `assistant` (with `toolCalls` when requested), and `tool` (with `toolCallId`, `isError`) roles; each carries the `seq` of its source event, its `turn` and `step`, its content blocks verbatim (reasoning included), and the recorded source kind |
| `steps` | One entry per model call with the adapter-reported usage |
| `reward` | `outcome` `1` when a certificate covers the current standard revision, `0` when a standard exists without one, `null` otherwise; `basis` `certificate`, `uncertified-completion` (goal completed, no standard ever authored), or `none` (no goal); the goal snapshot, the covering certificate, and the directive and relaxation counts |
| `provenance` | Component ids in the component registry's scheme (`composition:<preset>`, `model-provider:<provider>`, `tool:<name>`), tool names in first-use order, and the certificate's isolation level |

Token ids and logprobs are absent: the harness never sees token ids, and on-policy capture belongs to a trainer's inference proxy.

## Model Experience

None, as export reads persisted logs and writes files; it adds nothing to any model request.

#### KV Cache effect

None; the service neither adds to nor changes any model request.

## Known Limitations and Deferred Work

- **Off-policy text** — a trainer re-tokenizes exported text through its chat template, which suits supervised and rejection-sampled training; strict on-policy reinforcement learning needs an inference proxy in front of the harness.
- **No redaction** — tool results may carry credentials or private data; the sink is where a deployment applies a filter, and the telemetry redaction rules are the precedent.
- **One standard per session** — the reward reads the session's verification fold, which holds one completion standard; a session measuring several goals is scored by the standard in force.
- **No per-environment grouping** — rejection-sampling export grouped by environment follows the environment runner.
