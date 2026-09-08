# Environments and trajectories

English | [中文](improvement.zh.md)

Types shared by the improvement seam. An environment declares one task with executable checks in the completion-standard vocabulary; the runner runs it as one fresh session and stamps the log with what ran; the fleet runs a plan of environment × model × repetition cells and folds a leaderboard; a trajectory is one persisted session folded into the `dsh-trajectory/1` record a trainer reads, with the reward a certificate decided; session facts are the same session folded into the row a scoreboard is grouped from; an experiment result is the paired comparison of two arms over the same cells; a shift is one durable, cadenced pass of the fleet whose ledger lives in its own session log; a program is one client deliverable decomposed into department goals whose ledger lives in the program's own session; and an observatory snapshot is the public fold of every persisted session, with the withheld districts and the held-out split kept out of its rows and counted. The [trajectory-export](../../.agents/notes/proposed/architecture/2026-09-05-trajectory-export-and-environment-registry.md), [environment-runner](../../.agents/notes/proposed/architecture/2026-09-05-environment-runner.md), [scorekeeper](../../.agents/notes/proposed/architecture/2026-09-05-scorekeeper.md), [four-goal-workflows](../../.agents/notes/proposed/architecture/2026-09-05-four-goal-workflows.md), [village-shifts](../../.agents/notes/proposed/architecture/2026-09-05-village-shifts.md), [program-ledger](../../.agents/notes/proposed/architecture/2026-09-06-program-ledger.md), and [observatory](../../.agents/notes/proposed/architecture/2026-09-06-observatory.md) Agent Notes own the design; this page records the exact fields from [`packages/improvement/environments/src/types.ts`](../../packages/improvement/environments/src/types.ts), [`packages/improvement/fleet/src/types.ts`](../../packages/improvement/fleet/src/types.ts), [`packages/improvement/trajectories/src/types.ts`](../../packages/improvement/trajectories/src/types.ts), [`packages/improvement/scorekeeper/src/types.ts`](../../packages/improvement/scorekeeper/src/types.ts), [`packages/improvement/experiments/src/types.ts`](../../packages/improvement/experiments/src/types.ts), [`packages/improvement/shifts/src/types.ts`](../../packages/improvement/shifts/src/types.ts), [`packages/improvement/program/src/types.ts`](../../packages/improvement/program/src/types.ts), and [`packages/improvement/observatory/src/types.ts`](../../packages/improvement/observatory/src/types.ts).

## Environment definition

`EnvironmentId` is a [branded id](core.md#branded-ids). The `checks` are the same `StandardCheck` values a validator authors a completion standard from, so evaluation and production measure the same outcomes; `heldOut` marks tasks reserved for evaluation.

```ts type-equiv
/** The work an environment asks of an agent. */
interface EnvironmentTask {
  /** Complete task statement handed to the agent as its first user message. */
  readonly prompt: string
  /** Workspace fixture the runner mounts before the task starts, absent for a task that needs no files. */
  readonly fixture?: string
  /**
   * Workspace-relative paths the fixture supplies and the implementer must not
   * author — the tests, the reference outputs, and any overlaid check script.
   * Each is a `/`-separated relative path without `.` or `..` segments, naming
   * a file or a directory tree; the runner digests them beside the validator's
   * own directory and records a run that changed them as tampered.
   */
  readonly immutable?: readonly string[]
  /**
   * Fixture-relative directory holding the reference program a validator may
   * execute and an implementer may never read. It is a `/`-separated relative
   * path without `.` or `..` segments, naming a directory inside `fixture`;
   * the runner copies it beneath the barrier root at reservation time and
   * removes it from every workspace overlay, so the reference reaches the
   * validator's reservation and never the implementer's tree. A `recreation`
   * environment must declare one; every other kind may.
   */
  readonly reference?: string
}
```

## Run stamp

The runner appends one `environment/run` event before a run's first turn. It is the durable link from a session to its environment: every fold that groups, decontaminates, or ranks sessions by environment reads it from the log, and the exporter withholds held-out sessions and configured districts by it.

```ts type-equiv
/**
 * Durable link from a session to the environment it ran, written by the
 * runner as the `environment/run` event before the run's first turn. Every
 * fold that groups, decontaminates, or ranks sessions by environment reads it
 * from the log instead of from an in-memory report.
 */
interface EnvironmentRunStamp extends EnvironmentContentHashes {
  readonly kind: 'environment/run'
  readonly version: 1
  /** Environment that was run. */
  readonly environmentId: EnvironmentId
  /** Declared kind of the environment. */
  readonly environmentKind: string
  /** Whether the environment is reserved for evaluation; exports drop held-out sessions unless asked to keep them. */
  readonly heldOut: boolean
  /** Zero-based repetition of this environment inside its batch; paired designs match repetitions across variants. */
  readonly repetition: number
  /** Batch or sampling group the run belongs to, absent for a single run. */
  readonly group?: string
  /** District the run belongs to; exports withhold the districts a deployment configures by it, absent for a run outside every district. */
  readonly district?: string
  /**
   * Checkpoint or policy the implementer route served, as the deployment names
   * it. Free-form: the harness never resolves it, and a fold that keys measured
   * difficulty by policy version compares the strings it finds. Absent for a
   * route the deployment did not version.
   */
  readonly policyVersion?: string
  /**
   * Sampling seed every request of the run asked for, absent for a run that
   * pinned none. It states what was asked for, not what a replay reproduces:
   * providers may ignore a seed and none of them promise identical tokens
   * across model or infrastructure versions.
   */
  readonly seed?: number
  /** Model route the run's first attempt ran on; every attempt of a run without a ladder ran on it. */
  readonly model: EnvironmentRunModel
  /**
   * Model route of each attempt in attempt order, present only for a run the
   * caller laddered. It is part of the arm's identity: a cell whose second
   * attempt escalated to another model measures something a single-model cell
   * does not, so a fold that groups by {@link model} alone would count the two
   * together. Its first entry always equals {@link model}, and its length is
   * the attempt bound that run was given.
   */
  readonly ladder?: readonly EnvironmentRunModel[]
  /** Isolation the deployment declared for the run's checks. */
  readonly isolation: CertificateIsolation
  /**
   * Who did the work: `route` for the session's own model route, or the
   * subagent provider name for a run delegated to an out-of-band coding agent.
   * A scoreboard row is keyed by it, so two implementers on one environment
   * stay two rows. Absent in a payload that states none, which is the route.
   */
  readonly implementer?: string
}
```

### The attempt ladder and the transcript interface

A run request may name one rung per attempt. Attempt `i` runs on `ladder[i - 1].model`, or on the run's own `model` when that rung names none, and the ladder's length is the run's attempt bound, overriding the composition's `maxAttempts`. The stamp records the resolved rungs beside `model`, which stays the first attempt's route, so a fold grouping by route sees where a run started and a fold grouping by arm sees the whole escalation; a fleet plan, an experiment arm, the scorekeeper's facts and rows, and the observatory's columns all carry it, so a laddered cell is never counted as a plain single-model one. Every attempt of the report states the route it ran on.

The two implementers ladder differently, and the difference is named on every attempt as `transcript`. A route implementer keeps its transcript: each attempt is another user turn of the one cell session, so the model reads its own earlier work and receives the `<validation_failed>` directive alone. A subagent implementer drops it: each attempt is one fresh child, so a later attempt's prompt restates the task statement ahead of the directive and its `environment/delegation` records `restatedTask`. A `keep` arm on an out-of-process child would need provider resume support the subagent seam does not advertise, so the in-process `spawn` provider is the route's `drop` counterpart. The [runner README](../../packages/improvement/environment-runner/README.md#the-attempt-ladder) owns the rung ceiling, the refusals, and how each implementer changes route.

### The implementer of a run

`implementer` names who did the work of every attempt: `route` for the session's own model route, driven turn by turn, or the name of a `ctx.subagents` provider each attempt was delegated to as one child run. A delegated run is created, stamped, standardized, validated, certified, and directed identically — only the way the workspace reaches its next state changes, and the runner still executes every check itself. The cell session records each child run as an `environment/delegation` event and carries no assistant turn of its own, so the trajectory exported from it holds no step. A fleet plan and a shift district each name one implementer for every cell, and the scoreboard keys a row by it: an external coding agent and the harness's own route on one environment are two rows, never one average. The [runner README](../../packages/improvement/environment-runner/README.md#the-two-implementers) owns what a delegated certificate proves and which providers an isolation claim above `none` refuses.

### Policy version, seeds, and what a replay reproduces

`policyVersion` is free-form text naming the checkpoint or policy a route served; the harness writes it into the stamp verbatim and never resolves it, so a fold keying measured difficulty by policy version compares the strings its logs carry. A fleet plan, an experiment plan, and a shift district each name one, and every cell of the plan is stamped with it.

`seed` on a plan is a **base**: each cell asks for `seed + repetition`, so one repetition index means one seed across every route and environment of the plan, which is what lets a paired experiment compare like with like. The runner pins the cell's seed and the deployment's `topP` on the agent's model selection, so every request of the cell samples the same way and each request is reconstructable from that session's `request/header` events. The stamp carries `seed` alone, because `topP` is constant across the deployment and the header already records it.

A seed records what a run **asked for**, never what the provider did. An adapter whose wire has no `seed` field drops it, a provider that accepts one may still ignore it, and none promise identical tokens across model or infrastructure versions. What a session log reproduces is its own transcript — the prompt, the tools, the header, and the recorded turns — not a fresh sample from the model.

## Run implementer

Who does the work of a cell's attempts. Both implementers are validated identically — the runner authors the standard, executes the checks itself, and certifies the tree it finds — so only the way the workspace reaches its next state changes. [The runner README](../../packages/improvement/environment-runner/README.md#the-two-implementers) owns which providers an isolation claim refuses and what a delegated certificate proves.

```ts type-equiv
/**
 * Who implements the work of one run: the session's own model route, driven
 * turn by turn as the runner has always driven it, or one out-of-band coding
 * agent started per attempt through the subagent seam.
 */
type EnvironmentRunImplementer =
  | { readonly kind: 'route' }
  | {
    readonly kind: 'subagent'
    /** Registered `ctx.subagents` provider each attempt's child run starts on. */
    readonly provider: string
    /** Short display label persisted with a session-backed child; absent leaves the provider's own naming. */
    readonly label?: string
  }
```

A plan compares two arms only while their cells run under one budget, so `ctx.environmentRuns.cellCaps(implementer)` answers what the caps of an arm's cell are and an experiment refuses a plan whose arms disagree; the [guard page](guard.md) owns the cap vocabulary.

## Leaderboard row

The fleet folds one row per model route and environment from the reports of one fleet run. A row never averages across isolation levels or across the held-out split: `isolation` and `heldOut` are columns a consumer partitions by, and a row whose cells all failed before a run carries neither an isolation claim nor an implementer. One plan runs one implementer, so a fleet row cannot mix two; the scoreboard, which folds across plans, keys its rows by the implementer instead.

```ts type-equiv
/**
 * One leaderboard row: one model route on one environment. Rows are never
 * averaged across isolation levels or across the held-out split; both are
 * columns a consumer partitions by.
 */
interface LeaderboardRow {
  readonly provider: string
  readonly model: string
  /**
   * Model route of each attempt in attempt order, as the plan's ladder resolved
   * it, absent for a row whose cells ran no ladder and for one whose cells all
   * failed before a run. One plan runs one ladder, so a fleet row cannot mix a
   * laddered cell with an unladdered one; the scoreboard, which folds across
   * plans, keys its rows by it instead.
   */
  readonly ladder?: readonly EnvironmentRunModel[]
  readonly environmentId: EnvironmentId
  readonly environmentKind: string
  readonly heldOut: boolean
  /** Isolation the runs declared, absent when every cell of the row failed before a run. */
  readonly isolation?: CertificateIsolation
  /**
   * Implementer the runs were stamped with — `route` or the subagent provider
   * name — absent when every cell of the row failed before a run.
   */
  readonly implementer?: string
  /** Cells that produced a report. */
  readonly runs: number
  /** Cells that produced no report. */
  readonly errors: number
  /** Reported cells whose run certified. */
  readonly certified: number
  /** `certified / runs`, `0` without runs. */
  readonly certificateRate: number
  /** Mean attempts over reported cells, `0` without runs. */
  readonly attemptsMean: number
  /** Summed model usage over reported cells. */
  readonly inputTokens: number
  readonly outputTokens: number
}
```

## Trajectory reward

The reward carries its basis: `tamper` when the last recorded run found the check-owned files changed (`0`, whatever else the log holds), `certificate` when a completion standard existed for the goal (the verifier decided, `1` with a covering certificate and `0` without), `uncertified-completion` when the goal completed with no standard ever authored, and `none` when the log holds no goal.

```ts type-equiv
/** The reward with its basis and the evidence behind it. */
interface TrajectoryReward {
  /** `1` for a certified completion, `0` for a measured goal without a covering certificate, `null` when no verifier decided. */
  readonly outcome: 1 | 0 | null
  readonly basis: TrajectoryRewardBasis
  /** Goal the reward measures, absent when the log holds none. */
  readonly goal?: TrajectoryGoal
  /** Certificate covering the current standard revision, present only when `outcome` is `1`. */
  readonly certificate?: VerificationCertificate
  /** Directives the validator issued during the session. */
  readonly directives: number
  /** Checks relaxed out of the standard during the session. */
  readonly relaxations: number
  /** Runs of the standard recorded during the session, passing or failing. */
  readonly attempts: number
}
```

The record carries `parity` beside `reward`: the `{ weightPassed, weightTotal }` of the last recorded run, absent when that run measured no cases. It is an auxiliary signal a shaped reward may read and never a replacement for the certificate-based `outcome`, which a weighted pass rate cannot decide.

Messages are projected from the session surface after compaction replacements, each carrying the seq of its source event; token ids and logprobs are absent because the harness never sees them.

## Session facts

The scorekeeper folds one session log into four groups, served both as the `sessionFacts` projection value of a live session and as the record `ctx.scorekeeper.facts()` reads out of persistence. Every field folds from a named session event; the source event of each one is tabulated in [the package README](../../packages/improvement/scorekeeper/README.md). Cost is one of them: the efficiency group sums the `costEur` the `usage/priced` records themselves state and keeps their `pricingDigests`, taking no pricing table of its own, and withholds the sum entirely when a usage-bearing step went unpriced. A scoreboard row is these records grouped by model route, environment, isolation level, implementer, held-out split, and district, and it carries a cost per certified session only when every certified session of the row states one. The outcome group carries the last run's `parity` beside `certified`, and a row means it over the sessions that measured cases: the certificate and the weighted pass rate are separate columns, never merged into one score and never ranked across. Two facts a publication reads sit beside them: `tamper` is the last run's verdict, `not-instrumented` for a session that recorded none, and the identity group's `compositionSha256` is the digest of the last `composition/manifest` in the log; a row states the digest only when every session of it states the same one, counts its `tampered` sessions and the reads the barrier refused across them, and lists the distinct executors of its certificates.

```ts type-equiv
/** One session log folded into the four fact groups. */
interface SessionFacts {
  readonly identity: SessionFactsIdentity
  readonly outcome: SessionFactsOutcome
  readonly efficiency: SessionFactsEfficiency
  readonly tools: SessionFactsTools
}
```

## Experiment result

An experiment freezes its plan by a content digest over the arms, the sorted environment ids, the repetition count, and the thresholds, then runs both arms through the fleet at the same repetition indexes under the stamp groups `experiment-<digest>-baseline` and `experiment-<digest>-candidate`. A repetition enters the statistics only when both arms reported it; [the package README](../../packages/improvement/experiments/README.md) owns the bootstrap and the verdict rule.

```ts type-equiv
/**
 * Outcome of one experiment. The sessions grouped by `arms` carry the durable
 * evidence; this record is the fold over them.
 */
interface ExperimentResult {
  /** Content digest of the frozen plan; both arm groups carry it. */
  readonly digest: string
  /** The two arms and the stamp group each ran under. */
  readonly arms: ExperimentArms
  /** One entry per environment, in plan order. */
  readonly cells: readonly ExperimentCell[]
  /** Paired repetition indexes over every environment; the bootstrap's units. */
  readonly seedsPaired: number
  /** Certificate-rate delta over every paired repetition, `0` without pairs. */
  readonly delta: number
  /** Bootstrap interval of `delta`, absent without pairs; the verdict reads it. */
  readonly interval?: ConfidenceInterval
  /** Model usage of both arms together. */
  readonly spend: ExperimentSpend
  /** Thresholds the digest froze, restated so a stored result is readable alone. */
  readonly thresholds: ExperimentThresholds
  /**
   * The ceilings every cell of both arms ran under, in cap evaluation order.
   * The plan is refused unless the two arms resolve to the same list, so one
   * entry states the budget the whole comparison was measured inside and a
   * reader of a stored result never has to find the composition that produced
   * it. Empty for a comparison whose deployment caps nothing.
   */
  readonly caps: readonly BudgetCap[]
  readonly verdict: ExperimentVerdict
}
```

## Observatory snapshot

The observatory folds the scoreboard through the scorekeeper over every persisted session, withholds the configured districts and the held-out split from its public rows, and counts what it dropped. Withholding is a row operation because it is already a session operation: the scoreboard key carries `district` and `heldOut`, so every session of a withheld row is withheld and no withheld session can reach a published row. No session event carries an `ExperimentResult`, so a fold that is handed none publishes no ranking; [the package README](../../packages/improvement/observatory/README.md) owns the publication rules and the rendered column set.

```ts type-equiv
/** One fold over every persisted session, before rendering decides what it shows. */
interface ObservatorySnapshot {
  /** Scoreboard rows that survived withholding, ordered by route, attempt ladder, environment, isolation, held-out split, and district. */
  readonly rows: readonly ScoreboardRow[]
  /** What withholding removed from those rows. */
  readonly withheld: ObservatoryWithheld
  /** Experiment results whose two arm routes both appear in {@link rows}; empty publishes no ranking. */
  readonly experiments: readonly ExperimentResult[]
  /** Session headers the fold read. */
  readonly sessions: number
  /** Folded sessions whose log carries no `environment/run` stamp, so no row can name their cell. */
  readonly unstamped: number
  /** Sessions that could not be read or folded. */
  readonly skipped: readonly ScorekeeperSkip[]
  /** Epoch milliseconds at which the fold ran. */
  readonly foldedAt: number
  /** Newest `createdAt` among the session headers the fold read, absent when the store held none. */
  readonly newestSessionAt?: number
  /** Batch refresh interval the page names, milliseconds. */
  readonly refreshIntervalMs: number
}
```

## Published row

`render(snapshot, now)` applies the row-level publication rules and returns a self-contained HTML page beside the same document as JSON. Past the configured staleness threshold both carry the staleness notice in place of every figure: the JSON states `stale: true` with no row and no ranking.

```ts type-equiv
/**
 * One published row: the honest column set, with the publication rules already
 * applied. `resolved` and `parity` are two fields and stay two — neither is
 * ever computed from the other, and no field merges them.
 */
interface ObservatoryPublishedRow {
  readonly provider: string
  readonly model: string
  /**
   * Route of each attempt in attempt order, absent for a row whose sessions
   * laddered none. It is published beside the route rather than folded into it:
   * a cell that escalated to another model on its second attempt is not the
   * same arm as one that stayed, and a page that showed only the first rung
   * would read as if it were.
   */
  readonly ladder?: readonly EnvironmentRunModel[]
  readonly environmentId: EnvironmentId
  readonly environmentKind: string
  /** District the row's sessions were stamped with, absent for a row outside every district. */
  readonly district?: string
  readonly heldOut: boolean
  readonly isolation: CertificateIsolation
  /** Who did the work of the row's sessions: `route`, or the subagent provider name of a delegated cell. */
  readonly implementer: string
  /** Executors of the row's certificates; empty for a row that certified nothing. */
  readonly certificateExecutors: readonly RunExecutor[]
  /** Composition digest every session of the row states, absent when the page shows `pending`. */
  readonly compositionSha256?: string
  readonly tamper: ObservatoryTamper
  /** Sessions of the row whose last recorded run carried the `tampered` verdict. */
  readonly tampered: number
  /**
   * Reads the barrier refused, summed over the row's sessions. It is published
   * beside the tamper column and never merged with it: a refused read is a cell
   * that tried to leave its workspace, while a tamper is one that changed the
   * files it was measured with.
   */
  readonly escapesDenied: number
  /** Sessions that recorded at least one run. */
  readonly runs: number
  /** Sessions that ended without recording one. */
  readonly errors: number
  /** Sessions holding a certificate. */
  readonly certified: number
  /** `certified / runs`: the certificate rate under its own name, `0` without runs. */
  readonly resolved: number
  /** Mean weighted pass rate over the row's sessions that measured cases, absent when none did. */
  readonly parity?: number
  /** Mean cost of the row's certified sessions, absent unless {@link pricingDigest} names the one table that priced them. */
  readonly costEurPerCertified?: number
  /** The single pricing digest that priced the row, absent when the row carries none or more than one. */
  readonly pricingDigest?: string
}
```

## Cell announcement

The fleet announces each settled cell on the observe-only `fleet/cell` event, once its outcome is recorded and its workspace retention has run. The payload carries the durable coordinates rather than the in-memory report, so an observer writes its own per-cell record without holding the fleet's; [the package README](../../packages/improvement/fleet/README.md) states the emission order.

```ts type-equiv
/**
 * Payload of the observe-only `fleet/cell` event. It carries the durable
 * coordinates of one settled cell — the batch group, the district, and the
 * cell — so an observer can write its own record without holding the fleet's
 * in-memory report.
 */
interface FleetCellEvent {
  /** Batch identity every run stamp of this fleet run carries. */
  readonly group: string
  /** District the plan stamped its cells with, absent for a plan outside every district. */
  readonly district?: string
  /** The environment, model route, and repetition that settled. */
  readonly cell: FleetCell
  /** The settled outcome, exactly as the report keeps it. */
  readonly outcome: FleetCellEventOutcome
}
```

## Shift ledger

A shift is one durable pass of the fleet over a district's plan. Its identity is frozen before any cell runs — `shift-<digest>-<scheduledAt>`, over the district, the sorted environment ids, the routes in listing order, the repetitions, the policy version and base seed, and the token ceiling — and that id is the `group` on every cell's run stamp. The shift's own session log carries the ledger: `shift/start`, one `shift/cell` per settled cell, `shift/resume` when a later process picks the shift up, `shift/skipped` for a refused slot, and `shift/end`; [the persistence catalog](../persistence-catalog.md) carries each payload's declaration and [the package README](../../packages/improvement/shifts/README.md) owns the cadence and the resume rule.

```ts type-equiv
/**
 * One shift's frozen plan. `environments` holds the ids a config filter
 * resolved to against the registry at freeze time, so the digest and the cell
 * enumeration are decided before any cell runs and a registry that changes
 * mid-shift cannot move them.
 */
interface ShiftPlan {
  /** District every cell of the shift is stamped with. */
  readonly district: string
  /** Environments the shift runs, as resolved at freeze time. */
  readonly environments: readonly EnvironmentId[]
  /** Model routes in listing order, at least one; the fleet enumerates cells in it. */
  readonly models: readonly EnvironmentRunModel[]
  /** Who implements every cell of the shift; absent runs each cell's own model route. */
  readonly implementer?: EnvironmentRunImplementer
  /** Positive number of repetitions per environment and route; repetition indexes start at zero. */
  readonly repetitions: number
  /**
   * Checkpoint or policy the district's routes serve, written into every
   * cell's run stamp verbatim; absent for routes the deployment did not version.
   */
  readonly policyVersion?: string
  /**
   * Base sampling seed of the district; each cell samples with
   * `seed + repetition`. Absent leaves the cells' sampling to the composition.
   */
  readonly seed?: number
  /** Positive integer bound on the input plus output tokens the shift's reported cells may sum to. */
  readonly tokenCeiling?: number
}
```

A `shift/cell` record carries the cell's coordinates, the session the runner created for it when one exists, and one of three outcomes. `interrupted` is the orphan a later process found stamped but unrecorded: its session already exists, so the cell is never run again under the same repetition and the crash stays an error row.

```ts type-equiv
/**
 * What one cell of a shift produced: a report with its certification, the
 * failure that prevented one, or the crash that left a started cell with no
 * outcome at all.
 */
type ShiftCellOutcome =
  | { readonly kind: 'reported'; readonly certified: boolean }
  | { readonly kind: 'error'; readonly code?: string; readonly message: string }
  | { readonly kind: 'interrupted' }
```

## Program ledger

A program is one client deliverable decomposed into goals, frozen before any of them starts. `programSpecDigest(spec)` is the SHA-256 hex over the canonical spec — goals sorted by key, each goal's dependencies sorted, checks and gates in authored order, the resolved `implementer` covered, `signoff` excluded — and `program-<digest>` is both the program id and the program session's id. That session carries the ledger: `program/start`, one `program/goal` per status change, `program/integration`, `program/resume` when a later process picks the program up, and `program/end`; each department and the integration session carries one `program/member` stamp, and a delegated department adds one `program/delegation` per attempt. [The persistence catalog](../persistence-catalog.md) carries each payload's declaration and [the package README](../../packages/improvement/program/README.md) owns the departments, the merge order, and the resume rule.

```ts type-equiv
/** One client deliverable, frozen before its first department starts. */
interface ProgramSpec {
  /** What the whole program delivers, stated for a reader of the ledger. */
  readonly objective: string
  /** Git revision every worktree of the program is created from. */
  readonly baseRevision: string
  /** The goals the deliverable decomposes into, at least one. */
  readonly goals: readonly ProgramGoalSpec[]
  /** What the merged head is certified against. */
  readonly integration: ProgramIntegrationSpec
  /**
   * How every department of the program is staffed. A caller may omit it;
   * `resolveProgramSpec` materializes `{ kind: 'route' }`, so a
   * {@link FrozenProgramSpec} always states one and the digest always covers it.
   */
  readonly implementer?: ProgramImplementer
  /** The artefact the program's signatures attest; required by `requireSignoff`. */
  readonly signoff?: ProgramSignoff
  /** Input plus output tokens every session of the program may sum to. */
  readonly tokenCeiling?: number
}
```

`implementer` decides who writes the code, for every department of the program alike. `route` is the harness agent the service drives itself through the LLM seam, one user turn per attempt; `subagent` delegates each attempt to one child run of a registered `ctx.subagents` provider, which writes into the department worktree it derives from the department session's own `cwd`. The program keeps the checks, the certificate, the caps, and the ledger either way, and a department delegated to a provider that runs its child outside this process may claim no isolation above `none`.

```ts type-equiv
/**
 * How every department of one program is staffed.
 *
 * `route` is the harness agent the program drives itself through the LLM seam,
 * one user turn per attempt. `subagent` delegates each attempt to one child run
 * of a registered `ctx.subagents` provider, which writes into the department's
 * worktree while the program keeps the checks, the certificate, the caps, and
 * the ledger.
 */
type ProgramImplementer =
  | { readonly kind: 'route' }
  | {
    readonly kind: 'subagent'
    /** Name the provider is registered under on `ctx.subagents`. */
    readonly provider: string
    /** Display label persisted with a session-backed child, passed through to the provider. */
    readonly label?: string
  }
```

One goal is one department: its own git worktree on `<branchPrefix>/<programId>/<key>`, its own session composed from `preset`, its own `budget/caps`, and its own standard authored from `checks`. `dependsOn` is a directed acyclic graph over the program's keys, and a goal starts once every goal it depends on has certified.

```ts type-equiv
/** One goal of a program: what one department delivers, and what certifies it. */
interface ProgramGoalSpec {
  /** Lower-kebab-case identity, unique in the program; it names the branch and the worktree. */
  readonly key: string
  /** The objective the department's goal is created with. */
  readonly objective: string
  /** Id of a shipped preset declaring the `implementer` role, mounted into the department session. */
  readonly preset: string
  /** Isolation the department's certified run claims. */
  readonly isolation: CertificateIsolation
  /** Caps recorded on the department session before its first turn. */
  readonly budget: ProgramGoalBudget
  /** Keys of the goals this one is delivered after; a directed acyclic graph over the program's keys. */
  readonly dependsOn: readonly string[]
  /** The standard the department is certified against, compiled before any department starts. */
  readonly checks: readonly StandardCheck[]
}
```

A goal's status is derivable from what the departments themselves hold, which is what a restart reconciles: `certified` follows a `verification/certificate` in the department's own log, `blocked` follows its goal reaching the blocked phase, `merged` follows a certified integration over its branch, `failed` follows a department that ended without a certificate or lost its worktree, and `abandoned` follows a program that ended before the goal started.

```ts type-equiv
/**
 * Status of one goal in its program's ledger.
 *
 * `pending` has no department yet, `running` has one working, `blocked` waits
 * for an operator's resume through the goal domain, `certified` holds a
 * certificate over its own branch head, `merged` has that branch inside a
 * certified integration, `failed` ended without a certificate, and `abandoned`
 * never started because the program ended first.
 */
type ProgramGoalStatus =
  | 'pending'
  | 'running'
  | 'blocked'
  | 'certified'
  | 'failed'
  | 'merged'
  | 'abandoned'
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxenvironmentruns--environmentrunner"></a>

### `ctx.environmentRuns` — `EnvironmentRunner`

Environment runner (`ctx.environmentRuns`): one registered environment as one validated session.

```ts cordis-catalog
/**
 * Run one environment as one fresh session and validate it.
 * @param request - environment id, absolute workspace directory, optional
 *   implementer, model route, repetition, group, district, policy version,
 *   sampling seed, and abort signal.
 * @returns the stamp, the attempts, the certificate when one run passed, the
 *   accumulated usage, and the caps the cell ran under.
 * @throws {@link EnvironmentRunError} for an unknown environment, a seed that
 *   is not a safe non-negative integer, an implementer provider the
 *   composition does not hold, cannot confine, or has no budget policy to
 *   bound, an unusable workspace or fixture, an implementer that replaced the
 *   goal, or a lost standard.
 */
async run(request: EnvironmentRunRequest): Promise<EnvironmentRunReport>

/**
 * The caps one cell runs under, before the cell's own session tightens them.
 * A planner compares two arms with it: arms whose cells run under different
 * caps measure different things, however identical the rest of the plan is.
 *
 * A cell on the session's own route runs under every cap the deployment
 * configured. A delegated cell runs under the caps this runner can measure for
 * an implementer that spends outside this process, which is every one of them
 * except a cost cap the deployment states no foreign exchange rate for.
 *
 * @param implementer - who does the work of the cell's attempts.
 * @returns the caps in cap evaluation order; empty without a composed budget policy.
 * @throws {@link EnvironmentRunError} when a delegated implementer has no budget policy to bound it.
 */
cellCaps(implementer: EnvironmentRunImplementer): readonly BudgetCap[]

/**
 * Mint one agent's reservation and copy the environment's reference program
 * beneath it, for a validator that derives the standard from that reference
 * before an implementer is ever driven. The copy lands in the same
 * {@link REFERENCE_DIR} the runner stocks for its own implementer, so the
 * instrument finds the reference at one path whichever session holds it, and
 * the whole reservation stays inside the check-owned digest.
 * @param agent - the agent whose session the reservation belongs to.
 * @param environment - the environment supplying the reference tree.
 * @returns the reservation the reference was staged in.
 * @throws {@link EnvironmentRunError} when the environment is unknown, it
 *   declares no reference, or no read barrier is composed to reserve from.
 */
async stageReference(agent: Agent, environment: EnvironmentId): Promise<string>
```

Types: [Agent](core.md) · [BudgetCap](guard.md)

Source: [`packages/improvement/environment-runner/src/index.ts:857`](../../packages/improvement/environment-runner/src/index.ts)

<a id="ctxenvironments--environmentregistry"></a>

### `ctx.environments` — `EnvironmentRegistry`

Environment registry (`ctx.environments`): tasks with verifiers, held at composition time.

```ts cordis-catalog
/**
 * Register one environment. Registrations are effects: the producer keeps
 * the returned disposer under its own fiber so disposal removes the entry.
 * @param definition - complete environment definition.
 * @returns the exact disposer that removes this registration and no later one under the same id.
 * @throws {@link EnvironmentError} when the id is already registered, the
 *   definition declares no checks, two checks share an id, an immutable
 *   path is not a normalized workspace-relative path, the task reference is
 *   missing on a `recreation` environment or is not a directory inside the
 *   fixture, or a configured near-duplicate threshold refuses the prompt
 *   against the opposite split.
 */
register(definition: EnvironmentDefinition): () => void

/**
 * The registered held-out environment whose task prompt is closest to one
 * candidate prompt, so a curator can score a proposal before paying for a
 * run. It reads the same normalization and similarity the admission rule
 * applies, and answers whether or not a threshold is configured.
 * @param prompt - candidate task statement.
 * @returns the nearest held-out environment and its similarity, or `undefined` when none is registered.
 */
nearestHeldOut(prompt: string): NearestEnvironment | undefined

/**
 * Read one environment.
 * @param id - environment identity.
 * @returns a detached definition, or `undefined` when nothing is registered under the id.
 */
get(id: EnvironmentIdType): EnvironmentDefinition | undefined

/**
 * List environments in registration order.
 * @param filter - kind and held-out selection; absent fields match everything.
 * @returns detached definitions.
 */
list(filter: EnvironmentFilter = {}): EnvironmentDefinition[]
```

Source: [`packages/improvement/environments/src/index.ts:382`](../../packages/improvement/environments/src/index.ts)

<a id="ctxexperiments--experimentservice"></a>

### `ctx.experiments` — `ExperimentService`

Experiments (`ctx.experiments`): a frozen, paired, budgeted comparison of two arms.

```ts cordis-catalog
/**
 * Freeze a plan, run both arms through the fleet at the same repetition
 * indexes, and fold the paired comparison. Every refusal happens before the
 * first cell runs; a cell the fleet kept as an error leaves its repetition
 * unpaired instead of failing the experiment.
 * @param plan - environments, repetitions, the two arms with their model
 *   routes and optional implementers, the workspace root, and an optional
 *   policy version, base seed, frozen digest, abort signal, and result sink.
 * @returns the digest, both arms with their stamp groups, one cell per
 *   environment, the pooled delta with its interval, the spend, the caps both
 *   arms ran under, and the verdict.
 * @throws {@link ExperimentError} for a plan that names no or a duplicate or
 *   unregistered environment, asks for no repetition, sets a seed that is not
 *   a safe non-negative integer, whose two arms would run under different
 *   caps, declares a digest its content does not freeze to, or projects more
 *   tokens than the budget.
 */
async run(plan: ExperimentPlan): Promise<ExperimentResult>
```

Source: [`packages/improvement/experiments/src/index.ts:119`](../../packages/improvement/experiments/src/index.ts)

<a id="ctxfleet--fleetservice"></a>

### `ctx.fleet` — `FleetService`

Fleet runs (`ctx.fleet`): a plan of environment cells through the runner, with a leaderboard.

```ts cordis-catalog
/**
 * Run every cell of a plan and fold the leaderboard. A cell whose run
 * throws is kept as an error outcome, as is a cell the route breaker or the
 * token ceiling refused to start; the fleet run itself rejects only for a
 * plan it cannot start.
 * @param plan - environments, model routes, an optional implementer,
 *   repetitions, an optional exact cell selection, workspace root, group,
 *   district, policy version, base seed, token ceiling, and abort signal.
 * @returns every cell's outcome in plan order, the leaderboard folded from the reports, and the run's spend.
 * @throws {@link FleetError} when the plan selects no environment, asks for
 *   no repetition, names no or an unenumerated cell, sets a token ceiling
 *   that is not a positive integer, or sets a seed that is not a safe
 *   non-negative integer.
 */
async run(plan: FleetPlan): Promise<FleetRunReport>
```

Source: [`packages/improvement/fleet/src/index.ts:301`](../../packages/improvement/fleet/src/index.ts)

<a id="ctxobservatory--observatoryservice"></a>

### `ctx.observatory` — `ObservatoryService`

Observatory (`ctx.observatory`): the withheld, staleness-aware scoreboard page.

```ts cordis-catalog
/**
 * Fold every persisted session into one publication-ready snapshot.
 * @param request - the experiment results the caller holds; absent publishes no ranking.
 * @returns the public rows in the page's stable order, what withholding
 *   removed, the rankable verdicts, the fold time, and the newest folded
 *   session's creation time.
 */
async snapshot(request: ObservatorySnapshotRequest = {}): Promise<ObservatorySnapshot>

/**
 * Render one snapshot as both faces of one publication.
 * @param snapshot - the fold to publish.
 * @param now - epoch milliseconds the publication is rendered at; it decides staleness against the configured threshold.
 * @returns the self-contained HTML page and the JSON document, which state the same facts.
 */
render(snapshot: ObservatorySnapshot, now: number): ObservatoryPage
```

Source: [`packages/improvement/observatory/src/index.ts:78`](../../packages/improvement/observatory/src/index.ts)

<a id="ctxprograms--programservice"></a>

### `ctx.programs` — `ProgramService`

Programs (`ctx.programs`): a durable, resumable ledger over one deliverable's goals.

```ts cordis-catalog
/**
 * Start one program, or resume the program its spec already identifies.
 *
 * The spec is frozen into a digest before anything runs, so starting the same
 * spec twice addresses one program: the second call reconciles the existing
 * ledger instead of forking a second one.
 * @param spec - the deliverable to run.
 * @returns the ledger this pass left behind.
 * @throws {@link ProgramError} when the spec, its presets, or the spec-freeze
 *   signature the program session must carry cannot support a program.
 */
async start(spec: ProgramSpec): Promise<ProgramReport>

/**
 * Reconcile every unfinished program in the persistence root and carry it on.
 *
 * Each program's goals are read from their own department sessions and
 * worktrees rather than from the ledger, so a process that died between a
 * durable fact and its ledger record records the fact rather than repeating
 * the work.
 * @returns one report per program this pass reconciled, in scan order.
 */
async resume(): Promise<ProgramReport[]>
```

Source: [`packages/improvement/program/src/index.ts:262`](../../packages/improvement/program/src/index.ts)

<a id="ctxscorekeeper--scorekeeperservice"></a>

### `ctx.scorekeeper` — `ScorekeeperService`

Scorekeeper (`ctx.scorekeeper`): session facts, the scoreboard, and the facts export.

```ts cordis-catalog
/**
 * Fold one persisted session into its facts record.
 * @param sessionId - the persisted session to read.
 * @returns the four fact groups with the stored header's identity.
 * @throws when the session cannot be read, or its goal or verification stream is malformed.
 */
async facts(sessionId: SessionId): Promise<SessionFactsRecord>

/**
 * Fold a scoreboard from persisted session logs, one row per model route,
 * environment, isolation level, held-out split, and district. A session that
 * cannot be read or folded is reported and the fold continues.
 * @param filter - the sessions to fold and the group and held-out conditions a stamped session must meet.
 * @returns the rows with their pass@k statistics, the counts of excluded, unstamped, and skipped sessions, and the fold time.
 */
async leaderboard(filter: LeaderboardFilter = {}): Promise<ScoreboardBatch>

/**
 * Write one JSON line per session's facts record. A session that cannot be
 * read or folded is reported and the export continues; the sink is closed
 * exactly once when every session has been handled.
 * @param request - sessions to export and the destination sink.
 * @returns counts of sessions, written lines, and skips with reasons.
 */
async exportFacts(request: FactsExportRequest): Promise<FactsExportReport>
```

Types: [SessionId](core.md)

Source: [`packages/improvement/scorekeeper/src/index.ts:190`](../../packages/improvement/scorekeeper/src/index.ts)

<a id="ctxshifts--shiftservice"></a>

### `ctx.shifts` — `ShiftService`

Shifts (`ctx.shifts`): a cadenced, spend-windowed, resumable loop over fleet plans.

```ts cordis-catalog
/**
 * Resume every interrupted shift, then open each district's due slot and arm
 * its cadence timer. The loop runs once per process: a second call joins the
 * first, so the plugin's own start and a driver awaiting the first slot
 * observe the same run.
 * @returns a promise settling once every resumed shift has ended and every
 *   district is either running its due slot or armed for its next one.
 */
async start(): Promise<void>

/**
 * Stop the loop: disarm every cadence timer, cancel the fleet run in flight
 * through its signal, and wait for the slots that are settling. The
 * interrupted cells end as the runner ends them and their sessions become
 * the orphans the next process records.
 * @returns a promise settling once no slot is in flight.
 */
async stop(): Promise<void>
```

Source: [`packages/improvement/shifts/src/index.ts:125`](../../packages/improvement/shifts/src/index.ts)

<a id="ctxtrajectories--trajectoryservice"></a>

### `ctx.trajectories` — `TrajectoryService`

Trajectory exporter (`ctx.trajectories`): persisted sessions as training and evaluation records.

```ts cordis-catalog
/**
 * Fold the requested sessions and write one line per trajectory. A session
 * that cannot be read or folded is reported and the export continues; the
 * sink is closed exactly once when every session has been handled.
 * @param request - sessions to export, the destination sink, the reward filter, the held-out opt-in, and the districts to write.
 * @returns counts of sessions, written lines, rewarded lines, filtered
 *   sessions, withheld held-out and district sessions, and skips with reasons.
 */
async export(request: TrajectoryExportRequest): Promise<TrajectoryExportReport>
```

Source: [`packages/improvement/trajectories/src/index.ts:80`](../../packages/improvement/trajectories/src/index.ts)

<a id="fleet-events"></a>

### `fleet/*` events

<a id="fleetcell--emit"></a>

#### `fleet/cell` — emit

One cell of a running plan settled: the fleet has recorded its outcome and applied the configured workspace retention. Observe-only — a listener cannot change the outcome, and its failure is contained without failing the cell. Cells are emitted in settle order, which equals plan order only while `maxConcurrent` is `1`.

```ts cordis-catalog
/**
 * One cell of a running plan settled: the fleet has recorded its outcome
 * and applied the configured workspace retention. Observe-only — a
 * listener cannot change the outcome, and its failure is contained without
 * failing the cell. Cells are emitted in settle order, which equals plan
 * order only while `maxConcurrent` is `1`.
 * @param payload.group - batch identity every run stamp of this fleet run carries.
 * @param payload.district - district the plan stamped its cells with, absent for a plan outside every district.
 * @param payload.cell - the environment, model route, and repetition that settled.
 * @param payload.outcome - the session and certification of a reported cell, or the code and message of a cell that produced none.
 * @mode emit
 */
'fleet/cell'(payload: FleetCellEvent): void
```

Source: [`packages/improvement/fleet/src/index.ts:55`](../../packages/improvement/fleet/src/index.ts)
<!-- END GENERATED cordis-surface -->
