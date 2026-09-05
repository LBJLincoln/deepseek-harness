# 环境与轨迹

[English](improvement.md) | 中文

改进 seam 的两个注册表共享的类型。一个环境以完成标准词汇声明一个带可执行检查的任务；一条轨迹是一个已持久化会话折叠成的、训练器可读的 `dsh-trajectory/1` 记录，其奖励由证书决定。[轨迹导出 Agent Note](../../.agents/notes/proposed/architecture/2026-09-05-trajectory-export-and-environment-registry.md) 承载设计；本页记录 [`packages/improvement/environments/src/types.ts`](../../packages/improvement/environments/src/types.ts) 与 [`packages/improvement/trajectories/src/types.ts`](../../packages/improvement/trajectories/src/types.ts) 中的精确字段。

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
}
```

消息从压缩替换之后的会话表面投影而来，每条携带来源事件的 seq；不含 token id 与 logprob，因为 harness 从不看到它们。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Source: [`packages/improvement/environments/src/index.ts:71`](../../packages/improvement/environments/src/index.ts)

<a id="ctxtrajectories--trajectoryservice"></a>

### `ctx.trajectories` — `TrajectoryService`

Trajectory exporter (`ctx.trajectories`): persisted sessions as training and evaluation records.

```ts cordis-catalog
/**
 * Fold the requested sessions and write one line per trajectory. A session
 * that cannot be read or folded is reported and the export continues; the
 * sink is closed exactly once when every session has been handled.
 * @param request - sessions to export, the destination sink, and the reward filter.
 * @returns counts of sessions, written lines, rewarded lines, filtered sessions, and skips with reasons.
 */
async export(request: TrajectoryExportRequest): Promise<TrajectoryExportReport>
```

Source: [`packages/improvement/trajectories/src/index.ts:55`](../../packages/improvement/trajectories/src/index.ts)
<!-- END GENERATED cordis-surface -->
