# @deepseek-ai/dsh-scorekeeper

English | [中文](README.zh.md)

The session log as the dataset. A `sessionFacts` projection unit folds one live session into four fact groups, and `ctx.scorekeeper` folds the same groups out of persisted logs: one record per session, a scoreboard grouped by model route, environment, isolation level, and held-out split, and a JSONL export. The service reads through the session persistence seam and writes no session event. The [scorekeeper Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-scorekeeper.md) owns the design rationale.

## Config

```yaml
- id: persistence
  name: '@deepseek-ai/dsh-session-persistence-jsonl'
  config:
    root: './.sessions'
- id: scorekeeper
  name: '@deepseek-ai/dsh-scorekeeper'
  config:
    passAtK: [1, 8]
```

| Key | Default | Meaning |
|---|---|---|
| `passAtK` | `[1]` | Repetition draws the scoreboard estimates pass@k for. Sorted and de-duplicated; a `k` no batch of the row reached is absent from that row. |

The service requires a session persistence backend. It registers the `sessionFacts` projection unit only when a projection registry (`@deepseek-ai/dsh-session-projection`) is composed.

## Service contract

`ctx.scorekeeper.facts(sessionId)` reads one persisted session through `ctx.sessionPersistence.inspect()` and returns its `SessionFactsRecord`; a session that cannot be read, or whose goal or verification stream is malformed, rejects.

`ctx.scorekeeper.leaderboard({ sessions?, group?, heldOut? })` folds each named session (or every persisted session when `sessions` is absent) and groups the stamped ones into rows. A session that cannot be read or folded is added to `skipped` with its reason and the fold continues; a session whose log carries no `environment/run` stamp is counted as `unstamped` because no row can name its cell; a stamped session the `group` or `heldOut` condition rejects is counted as `excluded`.

`ctx.scorekeeper.exportFacts({ sessions?, sink })` writes `JSON.stringify(record) + '\n'` per session to `sink.write()` and closes the sink exactly once, after the last write or after a failure. The sink is the trajectory exporter's `TrajectorySink`, so `jsonlFileSink(path)` from `@deepseek-ai/dsh-trajectories` serves both exports.

`foldSessionFacts(meta, events)` is the pure projection behind all three and is exported for tests and offline tools, together with the incremental `applySessionFacts` the projection unit drives, the `foldScoreboard` row fold, and `unbiasedPassAtK`.

## Fact groups and their source events

Every field folds from a named session event; nothing is inferred. Field names are camelCase in TypeScript and in every export.

### Identity and provenance

| Field | Source |
|---|---|
| `sessionId`, `createdAt` | The stored session header (`facts()` and `exportFacts()` only; a projection value is already addressed by its session) |
| `environment.environmentId`, `.environmentKind`, `.heldOut`, `.repetition`, `.group`, `.contentSha256`, `.provider`, `.model`, `.isolation` | The `environment/run` stamp, absent for a session no runner stamped |
| `requestProvider`, `requestModel` | `config.provider` and `config.model` of the last `request/header` |

### Outcome

| Field | Source |
|---|---|
| `reward`, `rewardBasis` | The trajectory reward fold over `goal/change` and the `verification/*` events |
| `certified`, `certificateRevision` | The verification fold's certificate for the current standard revision |
| `runsRecorded` | `verification/run` events, passing or failing |
| `attempts` | The `attempt` of the last `verification/run`; it restarts at one for each authored standard |
| `directives` | `verification/directive` events |
| `relaxations` | Relaxed checks of the current standard (`verification/relaxation`) |
| `goalPhase`, `goalRoundsCap` | The current `goal/change` snapshot |
| `goalRoundsStarted` | Admitted continuation rounds, from the goal fold over `goal/change` and goal-sourced `user/message` |
| `budgetBreachCap` | The `cap` of the last `budget/breach` |

### Efficiency

| Field | Source |
|---|---|
| `turns`, `steps` | `turn/start` and `step/start` events |
| `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `reasoningTokens` | `usage` of every `assistant/message`; the earlier `assistant/chunk` sample for the same step is deliberately not counted twice |
| `wallMs` | The first and last event times of the log |

### Tool behavior

| Field | Source |
|---|---|
| `toolCalls`, `toolCallsByName` | `tool/call` events |
| `toolErrors` | `tool/result` events whose model-facing block reported an error |
| `toolTimeouts` | Those whose `error.code` is `TOOL_TIMEOUT` (`@deepseek-ai/dsh-tool-call-timeout-policy`) |
| `toolAborts` | Those whose `error.code` is `ABORTED` or `ABORTED_BEFORE_DISPATCH` (`@deepseek-ai/dsh-tools`) |

## Scoreboard rows

A row is one model route on one environment at one isolation level and one side of the held-out split; a row never averages across isolation or the split. `runs` counts the sessions that recorded at least one `verification/run` and `errors` the stamped sessions that recorded none, so a cell that ended without a run is a column rather than a missing row. `certificateRate` is `certified / runs` and `attemptsMean` the mean `runsRecorded` over the sessions with runs, both `0` without runs; the token sums cover every session of the row, the errored ones included.

`stats` estimates difficulty from the repetition batches the row's sessions belong to: for each batch of `n` sessions of which `c` certified, pass@k is the unbiased `1 - C(n - c, k) / C(n, k)`, and the row's value is the mean over the batches holding at least `k` sessions. A session whose stamp carries no `group` joins no batch.

## Model Experience

None, as the scorekeeper folds committed events into a projection value and reads persisted logs; it adds nothing to any model request.

#### KV Cache effect

None; the service neither adds to nor changes any model request.

## Known Limitations and Deferred Work

- **The projection value changes on every event** — `wallMs` spans the log, so no committed event leaves the `sessionFacts` state reference untouched and a subscribed carrier is notified once per event.
- **Field groups without a source event** — process quality, judge scores, safety and oversight, and training and data are named by the [four-goal-workflows note](../../../.agents/notes/proposed/architecture/2026-09-05-four-goal-workflows.md) but ship no field here: `signoff/recorded`, the composition manifest, the oversight monitor, the judge council, and the curator's consent and redaction events do not exist yet.
- **Shell exit codes are not observable** — a bash result's exit code travels inside the tool's own model-facing output rather than a session-event field, so `shellNonzeroExits` is not a field; a tool-owned result event would be needed first.
- **Cost is not a field** — pricing lives in `@deepseek-ai/dsh-budget-policy`'s configuration rather than in the log, so a facts record states tokens and names a breached cap but never a EUR amount.
- **One standard per session** — the outcome group reads the session's verification fold, which holds one completion standard; a session measuring several goals is scored by the standard in force.
- **Rows are not comparable across fleet runs** — a scoreboard folds whatever the filter selects; paired designs, confidence intervals, and cross-run comparison belong to the experiment plugin the four-goal note names.
