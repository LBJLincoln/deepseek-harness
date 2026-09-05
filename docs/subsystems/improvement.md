# Environments and trajectories

English | [中文](improvement.zh.md)

Types shared by the improvement seam's two registries. An environment declares one task with executable checks in the completion-standard vocabulary; a trajectory is one persisted session folded into the `dsh-trajectory/1` record a trainer reads, with the reward a certificate decided. The [trajectory-export Agent Note](../../.agents/notes/proposed/architecture/2026-09-05-trajectory-export-and-environment-registry.md) owns the design; this page records the exact fields from [`packages/improvement/environments/src/types.ts`](../../packages/improvement/environments/src/types.ts) and [`packages/improvement/trajectories/src/types.ts`](../../packages/improvement/trajectories/src/types.ts).

## Environment definition

`EnvironmentId` is a [branded id](core.md#branded-ids). The `checks` are the same `StandardCheck` values a validator authors a completion standard from, so evaluation and production measure the same outcomes; `heldOut` marks tasks reserved for evaluation.

```ts type-equiv
/** The work an environment asks of an agent. */
interface EnvironmentTask {
  /** Complete task statement handed to the agent as its first user message. */
  readonly prompt: string
  /** Workspace fixture the runner mounts before the task starts, absent for a task that needs no files. */
  readonly fixture?: string
}
```

## Trajectory reward

The reward carries its basis: `certificate` when a completion standard existed for the goal (the verifier decided, `1` with a covering certificate and `0` without), `uncertified-completion` when the goal completed with no standard ever authored, and `none` when the log holds no goal.

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

Messages are projected from the session surface after compaction replacements, each carrying the seq of its source event; token ids and logprobs are absent because the harness never sees them.

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
