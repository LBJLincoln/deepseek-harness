# Agent Note: Shifts, the always-on driver of the Daliesk Village

Status: proposed

English | [中文](2026-09-05-village-shifts.zh.md)

## Problem

The [Daliesk Village note](2026-09-05-daliesk-village.md) describes an always-running lab, and its shift zero runs with a human on call because nothing in the repository runs a plan more than once or survives a restart. `ctx.fleet.run(plan)` executes one plan inside one process and returns one report; when the process dies mid-plan, the cells already run survive only as session logs nobody indexes, the cells never started are forgotten, and a restarted process that runs the same plan again mints a new group and produces a second session for cells that already have one. The [four-goal note](2026-09-05-four-goal-workflows.md) names the missing piece in its rollout item 11 as durable orchestration, with cells idempotent by header hash × environment × repetition that recover from persisted child sessions, and the Village note's rollout item 3 makes unattended shifts depend on it. Four gaps stand between the fleet and an unattended shift: no durable identity for a shift, so a restart cannot tell a resumed plan from a new one; no per-cell durable record, so recovery has to be rebuilt from every session log; no cadence, so nothing starts the next shift and nothing keeps two shifts of one district from overlapping; and no spend window across shifts, so the fleet's per-plan ceiling is the only thing between a provider incident and a month of inference budget spent in one night.

## Proposal

Three details settled during slices 1 and 2. `ctx.fleet.run` gained an optional `cells` selection out of the plan's own enumeration, because a `FleetPlan` is a cross product and a resumed shift's pending set is not one — without it a resumed cell would run at repetition zero and double-count in its group. A district's plan names its model routes rather than falling back to the composition's default route, because the driver enumerates its own cells to compute a pending set and to digest the plan, and a digest that moved with another plugin's current selection would not freeze anything. The driver reads the environment registry through `ctx.get('environments')` rather than declaring it, keeping the Loader requirement at `fleet`, `sessions`, and `sessionPersistence`; a slot that cannot reach the registry is refused with `SHIFT_INVALID_PLAN`.

A `@deepseek-ai/dsh-shifts` plugin under `packages/improvement/shifts` providing `ctx.shifts`: a durable loop over the fleet that freezes each shift's identity, records the shift in its own session log, resumes an interrupted shift by running only the cells that never started, and refuses a shift that would overrun its district's spend window. The session event log stays the sole authority: the shift ledger is a set of `shift/*` events in a shift session, cells are recovered from the `environment/run` stamps their sessions already carry, and the driver holds nothing in memory that a restart needs.

### Shift identity

`shiftDigest(plan)` is the SHA-256 hex over `{ version, district, environments, models, repetitions, tokenCeiling }`, with the environment ids sorted by code unit after a filter is resolved against the registry at freeze time and the routes kept in listing order, following `planDigest` in `dsh-experiments`; `workspaceRoot`, the cadence, and the spend window are deployment choices and stay out of it. A shift instance is `shift-<digest>-<scheduledAt>`, the slot time in epoch milliseconds, so two processes computing the same slot compute the same identity without counting anything. The shift id is the `group` on every cell's stamp, so the sessions of one shift are grouped durably the way `experiment-<digest>-<arm>` groups an arm, and the scorekeeper's per-group pass@k needs no new field.

### The shift ledger

The driver creates one session per slot, as the runner creates one per cell, and appends to it: `shift/start { shiftId, digest, plan, scheduledAt }` with the frozen plan verbatim; `shift/cell { shiftId, cell, sessionId, outcome }` per cell once its outcome is in hand, `outcome` being `reported` with its `certified` flag, `error` with the fleet's code, or `interrupted` for an orphan found on resume; `shift/resume { shiftId, done, pending }` when a later process picks the shift up; `shift/skipped { digest, scheduledAt, reason }` with `reason` in `spend-window | overlap` when the slot is refused, in which case the slot's session holds that one event and no `shift/start`; and `shift/end { shiftId, outcome, spend, cells }` with `outcome` in `completed | ceiling | stopped`, where `spend` is the fleet report's token sum and `cells` the counts per outcome. Every event is appended after the fact it records is durable, never before. Cost in EUR is not a shift field: the scorekeeper folds it from `usage/priced` events under the Village note's rule that cost is a logged fact or is not published.

### Idempotent cells and resume

A cell is identified by its shift id, environment, model route, and repetition, all present on the `environment/run` stamp. On start, the driver lists persisted sessions through `ctx.sessionPersistence.list()`, loads every shift session whose log has a `shift/start` without a `shift/end`, and for each such shift computes the pending cells as the plan's cells minus those with a `shift/cell` entry minus those whose stamp exists in a session created at or after the shift session (header `createdAt`, which bounds the scan to sessions younger than the shift). A cell whose session exists but never ended is an orphan: it is recorded as `shift/cell` with `outcome: interrupted` and is never run again under the same repetition, because a second session for the same cell would double-count in pass@k and hide the crash; the crash is an outcome of the harness under test and stays an error row. The resumed shift runs the pending cells through `ctx.fleet.run` with the same group and district and with the plan's token ceiling reduced by the usage folded from every session the shift already has, then appends `shift/end`. The fleet gains one observe-only Cordis event, `fleet/cell { group, district, cell, outcome }`, emitted after each cell's outcome is recorded, so the ledger is written per cell rather than once per plan; the scan by stamp remains the authority whenever the ledger is behind.

### Cadence and spend window

Config: `workspaceRoot`; `districts`, a list of `{ district, plan, cadence: { intervalMs }, spendWindow?: { windowMs, maxTokens } }`; `startImmediately`. One shift per district is in flight at a time; the next slot of a district is the previous `shift/start.scheduledAt` plus `intervalMs`, read from the ledger, so a restart neither drifts nor doubles a slot; slots that passed while no process ran leave no record and are not caught up, the hole being visible from the slot arithmetic; a slot that arrives while the district's previous shift still runs is refused with `shift/skipped { reason: overlap }`. Before a shift starts, the driver folds `shift/end.spend` over the district's slots inside `windowMs`; a start that would begin with the window exhausted appends `shift/skipped { reason: spend-window }` and creates no cell session. The per-cell caps stay with the budget policy and the per-plan ceiling with the fleet; the window is the third layer, across plans, that the Village note's budgets section asks for.

### Process and supervision

The driver starts its loop on the application's ready event and stops on disposal: the in-flight fleet run is cancelled through its signal, in-flight cells end as the runner ends them, and their sessions become the orphans the next process records. A host-level supervisor, a systemd unit with `Restart=always` or a container restart policy, restarts the process; the README ships the unit file and the on-call runbook for the five conditions of the Village note (a crashed orchestrator, a route-wide outage past the retry budget, a full disk, a dead shift timer, a hung tool call), stating which the ledger makes visible (the first two and the timer, through a `shift/start` with no `shift/end` and a district with no recent slot) and which it does not (the disk and a hung call). Composition through the Loader requires `fleet`, `sessions`, and `sessionPersistence`; `verify-village-composition` already covers a shift composition because it composes the fleet.

## Alternatives considered

**A cron job around a fleet script.** Rejected: stateless; a restart or a second invocation runs the whole plan again under a new group, and nothing records that a slot was skipped or why.

**A workflow-engine program on the worker-thread engine.** Rejected for now: the current engine journals nothing, so a program dies with its process; the four-goal note's item 11 pairs the journaling engine with the program ledger, and this driver is the smallest durable loop such an engine can later host without changing the ledger events.

**Re-running an interrupted cell at the same repetition.** Rejected: the orphan session already carries the stamp, so the scorekeeper would see two sessions for one cell in one group; the crash is a harness outcome and belongs in the error column, and a shift with many interrupted cells is itself a finding.

**A ledger file beside the session logs.** Rejected: a second authority that persistence, replay, the session query tool, and the invariant companions know nothing about; the shift session reuses all of them.

**Ledger entries inside the cell sessions.** Rejected: a slot refused for its spend window would have no record at all, and a cell session belongs to the runner.

## Acceptance criteria

- A Loader-booted e2e runs a two-district composition through the driver, terminates the process after the first cell's session is durable, restarts it on the same persistence root, and the resumed shift keeps its group, appends `shift/resume` with the right pending set, runs only the cells with no session, records the orphan as `interrupted`, and the scoreboard shows one row per cell with the orphan as an error and never a duplicate environment, route, and repetition.
- `shiftDigest` is stable under environment reordering and changes with the repetitions, the routes, the district, or the token ceiling; a `shift/start` whose `plan` re-digests to another value fails the invariant companion.
- The invariant companion rejects a `shift/cell` before its `shift/start`, two `shift/cell` entries for one cell in one shift, and a `shift/end` before `shift/start`, each with a failing fixture.
- A spend window of one token yields `shift/skipped { reason: spend-window }` and no cell session; a slot arriving during a running shift yields `shift/skipped { reason: overlap }`.
- The fleet's `fleet/cell` event fires once per cell after the outcome is recorded, asserted in the fleet's existing e2e.
- The README pair carries the unit file, the runbook, and a Model Experience section stating that nothing here enters a model request; the Village note's rollout item 3 points here.

## Rollout

1. Landed. Fleet: the observe-only `fleet/cell` event with its unit and e2e assertions, plus the `cells` selection slice 2 needs to run a subset of one plan through `ctx.fleet.run`.
2. Landed. `dsh-shifts`: the digest, the shift session and `shift/*` events, resume by ledger and stamp scan, cadence, spend window, the invariant companion, a Loader-booted e2e with kill and restart, the README pair, the persistence catalog regenerated. The README also carries slice 4's unit file, container example, and runbook, so an operator reading the package has them before the gate message exists.
3. Scorekeeper: `shiftFacts`, one row per shift from the ledger, and the `district` column of `ScoreboardRow`, closing the Village note's TODO.
4. Supervision: the `verify-village-composition` message naming the driver when a shift composition lacks persistence; the unit file, the container example, and the runbook landed with slice 2.
5. Later, the journaling workflow engine of the four-goal note hosts the loop; the ledger events do not change.

## Risks

- **Scan cost on resume.** A persistence root with thousands of sessions makes the stamp scan slow; bounding it to sessions created after the shift session keeps it proportional to one shift, and the `fleet/cell` entries make the scan the exception.
- **Clock.** The cadence reads the host clock; a clock jump moves a slot and never doubles one, because the ledger decides.
- **Orphans in an incident.** A provider outage that kills cells mid-run inflates the error column; the fleet's route breaker limits it per plan, the spend window per district, and the rows stay truthful by design.
- **Disk.** Workspace retention exists; log retention does not, so a deployment that runs for months needs a retention plan for session logs before shift zero starts.
- **Two descriptions during rollout item 1.** Until the scorekeeper folds the ledger, the fleet report and the ledger both describe a shift; the ledger is the one a restart reads.
