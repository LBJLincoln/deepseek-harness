# Agent Note: The scorekeeper

Status: proposed

English | [中文](2026-09-05-scorekeeper.zh.md)

## Problem

Every number a fleet run reports today lives only in the process that produced it. `@deepseek-ai/dsh-fleet` folds a `LeaderboardRow` from the reports its own `run()` collected, so the leaderboard dies with the process: a restart, a second batch, or a question asked a week later has nothing to fold. The [four-goal-workflows note](2026-09-05-four-goal-workflows.md) states the opposite principle — the log is the dataset, and every metric must be recomputable from first principles — and names a Scoreboard row schema of 180 fields across eight groups, a `SessionFacts` projection, and an `EnvironmentStats` fold that W1 stage 2 and W3 stage 2 both read.

Two gaps sit between that principle and the code. Nothing folds a session log into per-session facts, so a consumer that wants turns, tokens, tool behavior, or the attempt count has to re-derive each of them from the raw events. And nothing measures difficulty: the runner already stamps every session with its environment, group, and repetition, but no fold turns a group of repetitions into pass@k, so a suite plan has no measured difficulty to select on and a calibration stage has nothing to read.

The 180-field schema is also not buildable today. Most of its groups — process quality, judge scores, safety and oversight, training and data — name fields whose source events do not exist: `signoff/recorded`, the composition manifest, the oversight monitor's verdicts, the judge council's scores, the curator's consent and redaction records. Shipping them as nullable columns would put empty fields in a training dataset and invite a consumer to read a `null` as a measurement.

## Proposal

Add `@deepseek-ai/dsh-scorekeeper` (`ctx.scorekeeper`) to the `improvement/` group: the fold that turns session logs into rows, and nothing else.

**Four groups, every field from a named event.** `SessionFacts` ships identity and provenance, outcome, efficiency, and tool behavior. A field exists only when a session event carries it today: the `environment/run` stamp supplies the cell identity, `request/header` the requested route, `goal/change` and the five `verification/*` events the outcome, `budget/breach` the cap that stopped a session, `turn/start`, `step/start` and `assistant/message` usage the efficiency, and `tool/call` and `tool/result` the tool behavior. The four remaining groups of the note's schema ship nothing until their producers exist, and the package README names them under Known Limitations so their absence is a recorded gap rather than a silent one. Field names are camelCase in TypeScript and in every export, unlike the note's snake_case sketch.

**One fold, two faces.** `applySessionFacts` is the incremental transition and `foldSessionFacts(meta, events)` the whole-log entry; the `sessionFacts` projection unit registers the first on `ctx.sessionProjections` under `ctx.inject`, and the service runs the second over persisted logs. Both therefore produce the same value, and a live carrier and an offline scoreboard can never drift. The outcome group is decided by the folds that already own those streams — `foldTrajectoryReward` (extracted from the trajectory fold for this purpose), `foldVerification`, and `foldGoal` — so the reward a scoreboard row reports is the reward a trajectory line reports, by construction rather than by review. The accumulator keeps the goal, verification, and budget events and refolds them whenever one arrives; the projection unit wraps the strict folds so a rejected change leaves the served value untouched instead of tearing the read side.

**The scoreboard is grouped, never averaged.** A row is one model route on one environment at one isolation level and one side of the held-out split, exactly the partitioning the fleet's leaderboard already respects. `runs` counts sessions that recorded at least one `verification/run` and `errors` the stamped sessions that recorded none, so a cell that ended without a run is a column rather than a missing row — the note's survivorship risk, answered. A session with no `environment/run` stamp names no cell and is counted apart.

**`EnvironmentStats` is pass@k over the batches the runner already stamps.** Each session's stamp carries a `group` and a `repetition`; the sessions sharing a group are one batch of `n` samples of which `c` certified, and pass@k for that batch is the unbiased `1 - C(n - c, k) / C(n, k)`, evaluated as a product so no factorial overflows. A row's estimate is the mean over the batches holding at least `k` sessions; a batch smaller than `k` contributes nothing and a `k` no batch reached is absent from the row. The `k` list is `Config`, because how many repetitions a deployment can afford is a deployment choice.

**Nothing is written.** The service reads through the session persistence seam and appends no event, so composing it changes no session log. `exportFacts` writes one JSON line per session through the trajectory exporter's `TrajectorySink`, so a deployment that already has a sink for trajectories has one for facts.

## Alternatives considered

**Persist a scoreboard store.** A durable table of rows written as runs finish would answer a query without re-reading logs. It is rejected because a stored row is a second source of truth that a schema change silently invalidates, and because the note's P3 makes the log the dataset: re-reading is the property, not the cost. A cache belongs behind the same fold once one is measured to be needed.

**Ship the note's 180 fields as nullable columns.** Shipping every named field with `null` where no producer exists would let downstream schemas stabilize early. It is rejected because a `null` in a training or evaluation record is indistinguishable from a measured absence, and because the note itself states that a metric without a source event is not a field.

**Fold the scoreboard inside `dsh-fleet`.** The fleet already folds a leaderboard, so extending it to read persisted logs would need no new package. It is rejected because the fleet's leaderboard is a fold of one in-memory run and its rows die with the process, while a scoreboard must answer over every session any composition ever persisted; keeping both makes the e2e comparison between them a real cross-check rather than a tautology.

**Duplicate the reward rules.** The outcome group could restate the trajectory fold's reward decision instead of extracting `foldTrajectoryReward`. It is rejected because two copies of "what counts as certified" is exactly the drift a leaderboard cannot survive; the extraction is behavior-preserving and the invariant companion checks the two folds still agree on every certificate.

**Snake_case field names.** The note sketches `session_id`, `reward_outcome`, and so on. It is rejected because every other record in this repository is camelCase in TypeScript and on the wire, and a consumer reading trajectories and facts side by side should not switch conventions between them; a trainer that wants snake_case renames at its own boundary.

## Acceptance criteria

- The `sessionFacts` projection unit appears in `ctx.sessionProjections.snapshot(session).values` when the scorekeeper is composed beside a projection registry, disappears when the service fiber is disposed, and leaves its served value untouched when the strict goal or verification fold rejects a change.
- Every shipped field is tabulated in the package README against the session event it folds from, and no field folds from anything else.
- `ctx.scorekeeper.leaderboard()` over the logs of a fleet run agrees with that fleet run's own in-memory leaderboard on `runs`, `certified`, `certificateRate`, and `attemptsMean` for every cell, proven by a Loader-booted example (`examples/headless-agent/tests/fixtures/scoreboard`).
- `ctx.scorekeeper.facts()` for a certified session carries reward `1` with basis `certificate`, the recorded run count, and non-zero token and tool counts; `exportFacts` writes one line per session and closes its sink exactly once.
- A stamped session that recorded no `verification/run` is an `errors` column of its row, and a session with no stamp is counted as `unstamped` rather than dropped.
- The package invariant recomputes `runsRecorded` against the raw count of `verification/run` events, `certified` against the reward fold's verdict, and a certificate's isolation against the isolation its `environment/run` stamp declared, and a keyless test proves the last relation rejects a certificate earned under another isolation level.

## Rollout

1. This note, the package, the `sessionFacts` projection unit, the scoreboard with pass@k, the JSONL export, and the Loader-booted example over the fleet-run stack.
2. Per-cell budgets from the fleet plan surfaced as facts, once the budget policy reads them: a breached cap is already a field, the configured limit is not.
3. The groups whose producers arrive later — process quality with `signoff/recorded` and the composition manifest, safety and oversight with the monitor's verdicts, training and data with the curator's consent and redaction records — each added with its producer, never ahead of it.
4. Cross-run comparison: paired designs, bootstrap confidence intervals, and cost per certified session belong to the experiment plugin the [four-goal-workflows note](2026-09-05-four-goal-workflows.md) names, reading these rows rather than replacing them.

## Risks

Refolding the kept goal and verification events on every such event is quadratic in their number. A session records a handful per attempt, so the cost is bounded in practice; a session that recorded thousands of verification changes would pay for it, and an incremental strict fold whose state is plain JSON is the fix if one ever appears.

The `sessionFacts` value changes on every committed event because `wallMs` spans the log, so a subscribed carrier is notified once per event rather than once per meaningful change. Dropping `wallMs` from the projection would restore the quiet path at the cost of a field the note names; the churn is accepted and recorded in the README instead.

A scoreboard folded over every persisted session mixes whatever a composition happens to have stored. The `group` filter is the only defence against comparing cells from unrelated batches, and a consumer that omits it gets an average across runs it did not intend; cross-run comparison stays the experiment plugin's job for exactly this reason.

Pass@k over a batch assumes the batch's sessions are independent samples of one cell. A deployment that reuses one `group` across environments or model routes still gets per-row batches, because a row is already partitioned by both, but a deployment that reuses a `group` across two fleet runs of the same cell will see them pooled.
