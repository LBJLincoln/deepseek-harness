# 环境与轨迹

[English](improvement.md) | 中文

改进 seam 共享的类型。一个环境以完成标准词汇声明一个带可执行检查的任务；运行器把它作为一个全新会话运行，并把所运行的内容盖章到日志上；fleet 运行环境 × 模型 × 重复的 cell 计划并折叠出排行榜；一条轨迹是一个已持久化会话折叠成的、训练器可读的 `dsh-trajectory/1` 记录，其奖励由证书决定；会话事实则是同一个会话折叠成的、记分板据以分组的行；实验结果则是两个 arm（实验分支）在同一批 cell 上的配对比较。[轨迹导出](../../.agents/notes/proposed/architecture/2026-09-05-trajectory-export-and-environment-registry.md)、[环境运行器](../../.agents/notes/proposed/architecture/2026-09-05-environment-runner.md)、[记分员](../../.agents/notes/proposed/architecture/2026-09-05-scorekeeper.md)与[四目标工作流](../../.agents/notes/proposed/architecture/2026-09-05-four-goal-workflows.md) Agent Note 承载设计；本页记录 [`packages/improvement/environments/src/types.ts`](../../packages/improvement/environments/src/types.ts)、[`packages/improvement/fleet/src/types.ts`](../../packages/improvement/fleet/src/types.ts)、[`packages/improvement/trajectories/src/types.ts`](../../packages/improvement/trajectories/src/types.ts) 、[`packages/improvement/scorekeeper/src/types.ts`](../../packages/improvement/scorekeeper/src/types.ts) 与 [`packages/improvement/experiments/src/types.ts`](../../packages/improvement/experiments/src/types.ts) 中的精确字段。

## 环境定义

`EnvironmentId` 是[带品牌的 id](core.md#branded-ids)。`checks` 与验证者据以编写完成标准的 `StandardCheck` 值相同，因此评估与生产度量同样的结果；`heldOut` 标记为评估保留的任务。

```ts type-equiv
/** The work an environment asks of an agent. */
interface EnvironmentTask {
  /** Complete task statement handed to the agent as its first user message. */
  readonly prompt: string
  /** Workspace fixture the runner mounts before the task starts, absent for a task that needs no files. */
  readonly fixture?: string
}
```

## 运行 stamp

运行器在一次运行的第一个轮次之前追加一条 `environment/run` 事件。它是会话与其环境之间的持久链接：所有按环境分组、去污染或排名会话的折叠都从日志中读取它，导出器也据此扣留留出会话与已配置的区。

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
  /** Model route the implementer ran on. */
  readonly model: EnvironmentRunModel
  /** Isolation the deployment declared for the run's checks. */
  readonly isolation: CertificateIsolation
}
```

## 排行榜行

fleet 从一次 fleet 运行的报告中折叠出每个模型路由与环境一行。行绝不会跨隔离级别或跨留出划分求平均：`isolation` 与 `heldOut` 是消费者据以分区的列，全部 cell 在运行前失败的行不携带隔离声明。

```ts type-equiv
/**
 * One leaderboard row: one model route on one environment. Rows are never
 * averaged across isolation levels or across the held-out split; both are
 * columns a consumer partitions by.
 */
interface LeaderboardRow {
  readonly provider: string
  readonly model: string
  readonly environmentId: EnvironmentId
  readonly environmentKind: string
  readonly heldOut: boolean
  /** Isolation the runs declared, absent when every cell of the row failed before a run. */
  readonly isolation?: CertificateIsolation
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

## 轨迹奖励

奖励携带其依据：当 goal 存在完成标准时为 `certificate`（由验证器决定，有覆盖证书为 `1`，没有为 `0`），当 goal 在从未编写标准的情况下完成时为 `uncertified-completion`，当日志中没有 goal 时为 `none`。

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

消息从压缩替换之后的会话表面投影而来，每条携带来源事件的 seq；不含 token id 与 logprob，因为 harness 从不看到它们。

## 会话事实

记分员把一个会话日志折叠为四个分组，既作为活动会话的 `sessionFacts` 投影值，也作为 `ctx.scorekeeper.facts()` 从持久化中读出的记录。每个字段都折叠自一个具名会话事件；各字段的来源事件在[包 README](../../packages/improvement/scorekeeper/README.md) 中列表说明。成本也是其中之一：效率分组对 `usage/priced` 记录自身所述的 `costEur` 求和并保留它们的 `pricingDigests`，自身不接受任何定价表；只要有一个携带 usage 的步骤未定价，这个和就完全不给出。记分板的一行就是这些记录按模型路由、环境、隔离级别、留出划分与区分组后的结果，并且只有当该行取得证书的每个会话都陈述成本时，该行才带每证书成本。

```ts type-equiv
/** One session log folded into the four fact groups. */
interface SessionFacts {
  readonly identity: SessionFactsIdentity
  readonly outcome: SessionFactsOutcome
  readonly efficiency: SessionFactsEfficiency
  readonly tools: SessionFactsTools
}
```

## 实验结果

一场实验以对 arm、排序后的环境 id、重复次数与阈值取内容摘要来冻结自己的计划，随后让两个 arm 都经 fleet 以相同的重复索引运行，处于 stamp group `experiment-<digest>-baseline` 与 `experiment-<digest>-candidate` 之下。只有当两个 arm 都报告了某次重复时，它才进入统计量；[包 README](../../packages/improvement/experiments/README.md) 拥有 bootstrap（自助重采样）与判定规则。

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
  readonly verdict: ExperimentVerdict
}
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
 * @param request - environment id, absolute workspace directory, optional model route, repetition, group, district, and abort signal.
 * @returns the stamp, the attempts, the certificate when one run passed, and the accumulated usage.
 * @throws {@link EnvironmentRunError} for an unknown environment, an unusable
 *   workspace or fixture, an implementer that replaced the goal, or a lost standard.
 */
async run(request: EnvironmentRunRequest): Promise<EnvironmentRunReport>
```

Source: [`packages/improvement/environment-runner/src/index.ts:279`](../../packages/improvement/environment-runner/src/index.ts)

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
 *   definition declares no checks, or two checks share an id.
 */
register(definition: EnvironmentDefinition): () => void

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

Source: [`packages/improvement/environments/src/index.ts:182`](../../packages/improvement/environments/src/index.ts)

<a id="ctxexperiments--experimentservice"></a>

### `ctx.experiments` — `ExperimentService`

Experiments (`ctx.experiments`): a frozen, paired, budgeted comparison of two arms.

```ts cordis-catalog
/**
 * Freeze a plan, run both arms through the fleet at the same repetition
 * indexes, and fold the paired comparison. Every refusal happens before the
 * first cell runs; a cell the fleet kept as an error leaves its repetition
 * unpaired instead of failing the experiment.
 * @param plan - environments, repetitions, the two arm routes, the workspace
 *   root, and an optional frozen digest, abort signal, and result sink.
 * @returns the digest, both arms with their stamp groups, one cell per
 *   environment, the pooled delta with its interval, the spend, and the verdict.
 * @throws {@link ExperimentError} for a plan that names no or a duplicate or
 *   unregistered environment, asks for no repetition, declares a digest its
 *   content does not freeze to, or projects more tokens than the budget.
 */
async run(plan: ExperimentPlan): Promise<ExperimentResult>
```

Source: [`packages/improvement/experiments/src/index.ts:102`](../../packages/improvement/experiments/src/index.ts)

<a id="ctxfleet--fleetservice"></a>

### `ctx.fleet` — `FleetService`

Fleet runs (`ctx.fleet`): a plan of environment cells through the runner, with a leaderboard.

```ts cordis-catalog
/**
 * Run every cell of a plan and fold the leaderboard. A cell whose run
 * throws is kept as an error outcome, as is a cell the route breaker or the
 * token ceiling refused to start; the fleet run itself rejects only for a
 * plan it cannot start.
 * @param plan - environments, model routes, repetitions, workspace root, group, district, token ceiling, and abort signal.
 * @returns every cell's outcome in plan order, the leaderboard folded from the reports, and the run's spend.
 * @throws {@link FleetError} when the plan selects no environment, asks for
 *   no repetition, or sets a token ceiling that is not a positive integer.
 */
async run(plan: FleetPlan): Promise<FleetRunReport>
```

Source: [`packages/improvement/fleet/src/index.ts:254`](../../packages/improvement/fleet/src/index.ts)

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

Source: [`packages/improvement/scorekeeper/src/index.ts:170`](../../packages/improvement/scorekeeper/src/index.ts)

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
<!-- END GENERATED cordis-surface -->
