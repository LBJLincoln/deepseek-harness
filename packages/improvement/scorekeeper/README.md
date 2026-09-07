# @deepseek-ai/dsh-scorekeeper

English | [中文](README.zh.md)

The session log as the dataset. A `sessionFacts` projection unit folds one live session into four fact groups, and `ctx.scorekeeper` folds the same groups out of persisted logs: one record per session, a scoreboard grouped by model route, environment, isolation level, implementer, held-out split, and district, and a JSONL export. The service reads through the session persistence seam and writes no session event. The [scorekeeper Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-scorekeeper.md) owns the design rationale.

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

`ctx.scorekeeper.leaderboard({ sessions?, group?, heldOut? })` folds each named session (or every persisted session when `sessions` is absent) and groups the stamped ones into one row per model route, environment, isolation level, implementer, held-out split, and district. A session that cannot be read or folded is added to `skipped` with its reason and the fold continues; a session whose log carries no `environment/run` stamp is counted as `unstamped` because no row can name its cell; a stamped session the `group` or `heldOut` condition rejects is counted as `excluded`.

`ctx.scorekeeper.exportFacts({ sessions?, sink })` writes `JSON.stringify(record) + '\n'` per session to `sink.write()` and closes the sink exactly once, after the last write or after a failure. The sink is the trajectory exporter's `TrajectorySink`, so `jsonlFileSink(path)` from `@deepseek-ai/dsh-trajectories` serves both exports.

`foldSessionFacts(meta, events)` is the pure projection behind all three and is exported for tests and offline tools, together with the incremental `applySessionFacts` the projection unit drives, the `foldScoreboard` row fold, and `unbiasedPassAtK`.

## Fact groups and their source events

Every field folds from a named session event; nothing is inferred. Field names are camelCase in TypeScript and in every export.

### Identity and provenance

| Field | Source |
|---|---|
| `sessionId`, `createdAt` | The stored session header (`facts()` and `exportFacts()` only; a projection value is already addressed by its session) |
| `environment.environmentId`, `.environmentKind`, `.heldOut`, `.repetition`, `.group`, `.district`, `.contentSha256`, `.provider`, `.model`, `.isolation`, `.implementer` | The `environment/run` stamp, absent for a session no runner stamped; a stamp naming no `implementer` folds as `route`, the run its own model route implemented |
| `requestProvider`, `requestModel` | `config.provider` and `config.model` of the last `request/header` |
| `implementerModel` | The `reportedModel` of the last `environment/delegation` that stated one ([`@deepseek-ai/dsh-environment-runner`](../environment-runner/README.md)), absent for a route-implemented session and for a provider that reports no model |
| `compositionSha256` | The `compositionSha256` of the last `composition/manifest` (`@deepseek-ai/dsh-components-manifest`), absent for a session whose log carries none |

### Outcome

| Field | Source |
|---|---|
| `reward`, `rewardBasis` | The trajectory reward fold over `goal/change` and the `verification/*` events |
| `certified`, `certificateRevision`, `certificateExecutor` | The verification fold's certificate for the current standard revision, and the executor of the run it cites |
| `parity` | The `parity` of the last `verification/run`, absent when that run measured no cases |
| `tamper` | The `verdict` of the last `verification/run`, `not-instrumented` when the session recorded none |
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
| `pricedSteps` | `usage/priced` events (`@deepseek-ai/dsh-budget-policy`) |
| `costEur` | The `costEur` those events state, summed |
| `pricingDigests` | Their distinct `pricingDigest` values, in first-seen order |
| `delegated.inputTokens`, `.outputTokens`, `.cacheReadTokens`, `.cacheWriteTokens`, `.costUsd` | The spend every `environment/delegation` states, summed; absent for a session whose delegations accounted for none |

`delegated` is where a delegated cell reports the work its own token fields cannot: such a cell drives no model turn, so its `inputTokens` is `0` while `delegated` holds the whole spend. Each delegation states at most one accounting — `usage` for an in-process child, read from that child's own log, or the `reportedUsage` and `reportedCostUsd` a foreign product claimed — so summing both double-counts nothing. `costUsd` is that product's own pricing rather than a harness pricing table and is never added to `costEur`, which is why the two are separate fields in separate currencies. It is what separates two implementers that both certify on their first attempt, where the certificate rate cannot.

The fold takes no pricing table: cost is the sum the `usage/priced` records themselves carry, so a deployment that re-rates a route cannot change what an already-run session cost. `costEur` is present only when every `assistant/message` that reported usage has a `usage/priced` for its turn and step, so a session that ran an unpriced route states no cost at all rather than the lower cost of its priced steps; a session whose log carries no usage-bearing message costs `0`. Two or more `pricingDigests` mean the log was priced under more than one table version and `costEur` is a sum across them.

### Tool behavior

| Field | Source |
|---|---|
| `toolCalls`, `toolCallsByName` | `tool/call` events |
| `toolErrors` | `tool/result` events whose model-facing block reported an error |
| `toolTimeouts` | Those whose `error.code` is `TOOL_TIMEOUT` (`@deepseek-ai/dsh-tool-call-timeout-policy`) |
| `toolAborts` | Those whose `error.code` is `ABORTED` or `ABORTED_BEFORE_DISPATCH` (`@deepseek-ai/dsh-tools`) |

## Scoreboard rows

A row is one model route and implementer on one environment at one isolation level, one side of the held-out split, and one district; a row never averages across the implementer, isolation, the split, or districts, so an external coding agent and the harness's own route on one environment stay two rows and a publication that withholds a district drops whole rows instead of blending them. `runs` counts the sessions that recorded at least one `verification/run` and `errors` the stamped sessions that recorded none, so a cell that ended without a run is a column rather than a missing row. `certificateRate` is `certified / runs` and `attemptsMean` the mean `runsRecorded` over the sessions with runs, both `0` without runs; the token sums cover every session of the row, the errored ones included.

Three columns state what a publication needs beside those rates. `tampered` counts the sessions whose last recorded run carried the `tampered` verdict; a row's `errors` is exactly its not-instrumented sessions, because a session that recorded no run carries no verdict to read. `compositionSha256` is the digest every session of the row states, absent when a session states none or two disagree, so a digest covering part of a row never attributes the whole row. `certificateExecutors` holds the distinct executors of the row's certified sessions in first-appearance order: empty for a row that certified nothing, and two or more for a row whose certificates disagree, where no single executor may be published beside its rate.

`certificateRate` and `parity` are two columns and stay two. The certificate measure — `certified`, `certificateRate`, and the `stats` estimates built on it — says that every case of every active check passed. `parity` is the mean of `weightPassed / weightTotal` over the row's sessions that measured cases, absent for a row where none did, and every such session counts once however many cases sampled it. Nothing this package renders merges the two into one score or ranks across them: a row that reached most of a standard's case weight and a row that certified are different facts about the work, and a consumer that ranks reads one column or the other. The [ProgramBench distinction](../../../.agents/notes/proposed/architecture/2026-09-06-competitive-baselines.md) is the same one.

`costEurPerCertified` is the mean `costEur` over the row's certified sessions, and `pricingDigests` the distinct digests across every session of the row, errored and uncertified ones included. The mean is absent for a row that certified nothing and absent when any certified session of the row states no cost, so a published cost per certified session never counts an unpriced session as a free one.

`stats` estimates difficulty from the repetition batches the row's sessions belong to: for each batch of `n` sessions of which `c` certified, pass@k is the unbiased `1 - C(n - c, k) / C(n, k)`, and the row's value is the mean over the batches holding at least `k` sessions. A session whose stamp carries no `group` joins no batch.

## Model Experience

None, as the scorekeeper folds committed events into a projection value and reads persisted logs; it adds nothing to any model request.

#### KV Cache effect

None; the service neither adds to nor changes any model request.

## Known Limitations and Deferred Work

- **The projection value changes on every event** — `wallMs` spans the log, so no committed event leaves the `sessionFacts` state reference untouched and a subscribed carrier is notified once per event.
- **Field groups without a source event** — process quality, judge scores, safety and oversight, and training and data are named by the [four-goal-workflows note](../../../.agents/notes/proposed/architecture/2026-09-05-four-goal-workflows.md) but ship no field here: `signoff/recorded`, the oversight monitor, the judge council, and the curator's consent and redaction events do not exist yet.
- **Shell exit codes are not observable** — a bash result's exit code travels inside the tool's own model-facing output rather than a session-event field, so `shellNonzeroExits` is not a field; a tool-owned result event would be needed first.
- **Cost covers priced routes only** — a route the deployment's pricing table did not name records no `usage/priced`, so a session that touched one states no `costEur` and every row holding it states no `costEurPerCertified`. A deployment that wants a cost for every session prices every route it runs.
- **One standard per session** — the outcome group reads the session's verification fold, which holds one completion standard; a session measuring several goals is scored by the standard in force.
- **Rows are not comparable across fleet runs** — a scoreboard folds whatever the filter selects; paired designs, confidence intervals, and cross-run comparison belong to the experiment plugin the four-goal note names.
