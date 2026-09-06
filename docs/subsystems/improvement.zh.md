# 环境与轨迹

[English](improvement.md) | 中文

改进 seam 共享的类型。一个环境以完成标准词汇声明一个带可执行检查的任务；运行器把它作为一个全新会话运行，并把所运行的内容盖章到日志上；fleet 运行环境 × 模型 × 重复的 cell 计划并折叠出排行榜；一条轨迹是一个已持久化会话折叠成的、训练器可读的 `dsh-trajectory/1` 记录，其奖励由证书决定；会话事实则是同一个会话折叠成的、记分板据以分组的行；实验结果则是两个 arm（实验分支）在同一批 cell 上的配对比较；一个班次是 fleet 一次持久、按节拍进行的运行，其台账存放在它自己的会话日志中；一个程序则是一份被拆解为部门目标的客户交付物，其台账存放在该程序自己的会话中；而一次观测台快照则是对全部持久化会话的公开折叠，被扣留的区与留出划分被挡在它的行之外并被计数。[轨迹导出](../../.agents/notes/proposed/architecture/2026-09-05-trajectory-export-and-environment-registry.md)、[环境运行器](../../.agents/notes/proposed/architecture/2026-09-05-environment-runner.md)、[记分员](../../.agents/notes/proposed/architecture/2026-09-05-scorekeeper.md)、[四目标工作流](../../.agents/notes/proposed/architecture/2026-09-05-four-goal-workflows.md)、[村庄班次](../../.agents/notes/proposed/architecture/2026-09-05-village-shifts.md)、[程序台账](../../.agents/notes/proposed/architecture/2026-09-06-program-ledger.md)与[观测台](../../.agents/notes/proposed/architecture/2026-09-06-observatory.md) Agent Note 承载设计；本页记录 [`packages/improvement/environments/src/types.ts`](../../packages/improvement/environments/src/types.ts)、[`packages/improvement/fleet/src/types.ts`](../../packages/improvement/fleet/src/types.ts)、[`packages/improvement/trajectories/src/types.ts`](../../packages/improvement/trajectories/src/types.ts) 、[`packages/improvement/scorekeeper/src/types.ts`](../../packages/improvement/scorekeeper/src/types.ts) 、[`packages/improvement/experiments/src/types.ts`](../../packages/improvement/experiments/src/types.ts) 、[`packages/improvement/shifts/src/types.ts`](../../packages/improvement/shifts/src/types.ts) 、[`packages/improvement/program/src/types.ts`](../../packages/improvement/program/src/types.ts) 与 [`packages/improvement/observatory/src/types.ts`](../../packages/improvement/observatory/src/types.ts) 中的精确字段。

## 环境定义

`EnvironmentId` 是[带品牌的 id](core.md#branded-ids)。`checks` 与验证者据以编写完成标准的 `StandardCheck` 值相同，因此评估与生产度量同样的结果；`heldOut` 标记为评估保留的任务。

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
  /** Model route the implementer ran on. */
  readonly model: EnvironmentRunModel
  /** Isolation the deployment declared for the run's checks. */
  readonly isolation: CertificateIsolation
}
```

### 策略版本、种子，以及 replay 能复现什么

`policyVersion` 是自由文本，点名某条路由所服务的检查点或策略；harness 把它原样写进 stamp，从不解析它，因此按策略版本给测得难度建键的 fold，比较的是它的日志所携带的字符串。fleet 计划、实验计划和班次的区各自点名一个，该计划的每个 cell 都以它盖戳。

计划上的 `seed` 是**基准**：每个 cell 请求 `seed + repetition`，因此同一个重复序号在该计划的每条路由和每个环境上都意味着同一个种子——这正是让配对实验比较同类的原因。运行器把该 cell 的种子与部署的 `topP` 钉在 agent 的模型选择上，于是这个 cell 的每一次请求都以相同方式采样，且每次请求都可从该会话的 `request/header` 事件重建。stamp 只携带 `seed`，因为 `topP` 在整个部署中恒定，而 header 已经记录了它。

种子记录的是一次运行**请求了什么**，绝不是提供方做了什么。线路上没有 `seed` 字段的适配器会丢弃它，接受它的提供方仍可以忽略它，而且没有任何一家承诺跨模型或基础设施版本产出相同的 token。会话日志复现的是它自己的 transcript——提示词、工具、header 和已记录的轮次——而不是一次新的模型采样。

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

奖励携带其依据：当最后记录的运行发现检查方拥有的文件已被改动时为 `tamper`（无论日志里还有什么，均为 `0`），当 goal 存在完成标准时为 `certificate`（由验证器决定，有覆盖证书为 `1`，没有为 `0`），当 goal 在从未编写标准的情况下完成时为 `uncertified-completion`，当日志中没有 goal 时为 `none`。

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

记录在 `reward` 旁携带 `parity`：最后记录的那次运行的 `{ weightPassed, weightTotal }`，该次运行没有度量用例时不存在。它是塑形奖励可以读取的辅助信号，绝不取代以证书为依据的 `outcome`——加权通过率决定不了后者。

消息从压缩替换之后的会话表面投影而来，每条携带来源事件的 seq；不含 token id 与 logprob，因为 harness 从不看到它们。

## 会话事实

记分员把一个会话日志折叠为四个分组，既作为活动会话的 `sessionFacts` 投影值，也作为 `ctx.scorekeeper.facts()` 从持久化中读出的记录。每个字段都折叠自一个具名会话事件；各字段的来源事件在[包 README](../../packages/improvement/scorekeeper/README.md) 中列表说明。成本也是其中之一：效率分组对 `usage/priced` 记录自身所述的 `costEur` 求和并保留它们的 `pricingDigests`，自身不接受任何定价表；只要有一个携带 usage 的步骤未定价，这个和就完全不给出。记分板的一行就是这些记录按模型路由、环境、隔离级别、留出划分与区分组后的结果，并且只有当该行取得证书的每个会话都陈述成本时，该行才带每证书成本。outcome 分组在 `certified` 旁携带最后一次运行的 `parity`，一行在度量了用例的会话上对它求均值：证书与加权通过率是两个各自独立的列，既不合并成一个分数，也不跨它们排名。与它们并列的还有发布所读取的两个事实：`tamper` 是最后一次运行的裁决，会话一次运行也没有记录时为 `not-instrumented`；identity 分组的 `compositionSha256` 是日志中最后一条 `composition/manifest` 的摘要。只有当一行的每个会话都陈述同一个摘要时该行才陈述它，同时该行统计自己的 `tampered` 会话，并列出自己证书的去重 executor。

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

## 观测台快照

观测台经记分员在全部持久化会话上折叠记分板，把配置的区与留出划分挡在公开行之外，并对丢弃的内容计数。扣留是一次行操作，因为它本来就是一次会话操作：记分板的键携带 `district` 与 `heldOut`，因此被扣留行中的每个会话都被扣留，任何被扣留的会话都不可能进入公开行。没有任何会话事件携带 `ExperimentResult`，因此没有收到结果的折叠不发布排名；[包 README](../../packages/improvement/observatory/README.md) 拥有发布规则与渲染出的列集。

```ts type-equiv
/** One fold over every persisted session, before rendering decides what it shows. */
interface ObservatorySnapshot {
  /** Scoreboard rows that survived withholding, ordered by route, environment, isolation, held-out split, and district. */
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

## 发布出的行

`render(snapshot, now)` 施加逐行的发布规则，返回一个自包含的 HTML 页面以及同一份文档的 JSON。超过配置的陈旧阈值后，两者都以陈旧提示取代全部数字：JSON 陈述 `stale: true`，且没有行、没有排名。

```ts type-equiv
/**
 * One published row: the honest column set, with the publication rules already
 * applied. `resolved` and `parity` are two fields and stay two — neither is
 * ever computed from the other, and no field merges them.
 */
interface ObservatoryPublishedRow {
  readonly provider: string
  readonly model: string
  readonly environmentId: EnvironmentId
  readonly environmentKind: string
  /** District the row's sessions were stamped with, absent for a row outside every district. */
  readonly district?: string
  readonly heldOut: boolean
  readonly isolation: CertificateIsolation
  /** Executors of the row's certificates; empty for a row that certified nothing. */
  readonly certificateExecutors: readonly RunExecutor[]
  /** Composition digest every session of the row states, absent when the page shows `pending`. */
  readonly compositionSha256?: string
  readonly tamper: ObservatoryTamper
  /** Sessions of the row whose last recorded run carried the `tampered` verdict. */
  readonly tampered: number
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

## cell 公告

每当一个 cell 的结果被记录、且其工作区保留策略执行完毕之后，fleet 就在只供观察的 `fleet/cell` 事件上公告它。载荷携带的是持久坐标而非内存中的报告，因此观察方无需持有 fleet 的报告即可写下自己的逐 cell 记录；[包 README](../../packages/improvement/fleet/README.md) 说明了发出顺序。

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

## 班次台账

一个班次是 fleet 针对某个区（district）的计划所做的一次持久运行。它的身份在任何 cell 运行之前就被冻结——`shift-<digest>-<scheduledAt>`，摘要取自区、排序后的环境 id、按列出顺序排列的路由、重复次数、策略版本与基准种子，以及 token 上限——该 id 就是每个 cell 运行 stamp 上的 `group`。班次自己的会话日志承载台账：`shift/start`、每个已结算 cell 一条 `shift/cell`、后续进程接手时的 `shift/resume`、时槽被拒绝时的 `shift/skipped`，以及 `shift/end`；[持久化目录](../persistence-catalog.md)记录每个载荷的声明，[包 README](../../packages/improvement/shifts/README.md) 拥有节拍与恢复规则。

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

一条 `shift/cell` 记录携带该 cell 的坐标、运行器为它创建的会话（若存在），以及三种结果之一。`interrupted` 是后续进程发现的遗留 cell：它有 stamp 却没有记录，其会话已经存在，因此该 cell 在同一重复序号下绝不会再运行，崩溃留在错误列里。

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

## 程序台账

一个程序是一份被拆解为多个目标的客户交付物，并在其中任何一个目标启动之前就被冻结。`programSpecDigest(spec)` 是对规范化规格取的 SHA-256 十六进制——目标按 key 排序、每个目标的依赖也排序、检查与门禁保持撰写顺序、`signoff` 被排除在外——而 `program-<digest>` 既是程序 id，也是程序会话的 id。该会话承载台账：`program/start`、每次状态变化一条 `program/goal`、`program/integration`、后续进程接手该程序时的 `program/resume`，以及 `program/end`；每个部门会话与整合会话各携带一条 `program/member` 标记。[持久化目录](../persistence-catalog.md) 收录了每个载荷的声明，[包 README](../../packages/improvement/program/README.md) 承载部门、合并顺序与恢复规则。

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
  /** The artefact the program's signatures attest; required by `requireSignoff`. */
  readonly signoff?: ProgramSignoff
  /** Input plus output tokens every session of the program may sum to. */
  readonly tokenCeiling?: number
}
```

一个目标就是一个部门：它有自己的 git worktree（位于 `<branchPrefix>/<programId>/<key>`）、由 `preset` 组合出的自有会话、自有的 `budget/caps`，以及由 `checks` 撰写的自有标准。`dependsOn` 是程序内 key 上的有向无环图，只有当某目标依赖的每个目标都已认证，它才会启动。

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

目标的状态可以从各部门自身持有的事实推导出来，这正是重启时所核对的内容：`certified` 跟随部门自身日志中的 `verification/certificate`，`blocked` 跟随其目标进入阻塞阶段，`merged` 跟随覆盖其分支的已认证整合，`failed` 跟随没有证书就结束或丢失了 worktree 的部门，`abandoned` 则跟随在该目标启动之前就结束的程序。

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
 *   model route, repetition, group, district, policy version, sampling seed, and abort signal.
 * @returns the stamp, the attempts, the certificate when one run passed, and the accumulated usage.
 * @throws {@link EnvironmentRunError} for an unknown environment, a seed that
 *   is not a safe non-negative integer, an unusable workspace or fixture, an
 *   implementer that replaced the goal, or a lost standard.
 */
async run(request: EnvironmentRunRequest): Promise<EnvironmentRunReport>
```

Source: [`packages/improvement/environment-runner/src/index.ts:546`](../../packages/improvement/environment-runner/src/index.ts)

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
 *   path is not a normalized workspace-relative path, or a configured
 *   near-duplicate threshold refuses the prompt against the opposite split.
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

Source: [`packages/improvement/environments/src/index.ts:321`](../../packages/improvement/environments/src/index.ts)

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
 *   root, and an optional policy version, base seed, frozen digest, abort
 *   signal, and result sink.
 * @returns the digest, both arms with their stamp groups, one cell per
 *   environment, the pooled delta with its interval, the spend, and the verdict.
 * @throws {@link ExperimentError} for a plan that names no or a duplicate or
 *   unregistered environment, asks for no repetition, sets a seed that is not
 *   a safe non-negative integer, declares a digest its content does not
 *   freeze to, or projects more tokens than the budget.
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
 * @param plan - environments, model routes, repetitions, an optional exact
 *   cell selection, workspace root, group, district, policy version, base
 *   seed, token ceiling, and abort signal.
 * @returns every cell's outcome in plan order, the leaderboard folded from the reports, and the run's spend.
 * @throws {@link FleetError} when the plan selects no environment, asks for
 *   no repetition, names no or an unenumerated cell, sets a token ceiling
 *   that is not a positive integer, or sets a seed that is not a safe
 *   non-negative integer.
 */
async run(plan: FleetPlan): Promise<FleetRunReport>
```

Source: [`packages/improvement/fleet/src/index.ts:300`](../../packages/improvement/fleet/src/index.ts)

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

Source: [`packages/improvement/program/src/index.ts:212`](../../packages/improvement/program/src/index.ts)

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

Source: [`packages/improvement/scorekeeper/src/index.ts:181`](../../packages/improvement/scorekeeper/src/index.ts)

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

Source: [`packages/improvement/shifts/src/index.ts:124`](../../packages/improvement/shifts/src/index.ts)

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
