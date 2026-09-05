/**
 * Experiments: a paired comparison of two arms over fleet cells. A plan is
 * frozen by a content digest before any cell runs, both arms run through the
 * fleet at the same repetition indexes under groups derived from that digest,
 * and the paired certificate-rate delta is reported with a bootstrap interval
 * and a verdict. Nothing here calls a model. The
 * [experiments Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-experiments.md)
 * owns the design rationale.
 * @module @deepseek-ai/dsh-experiments
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: resolves ctx.environments.
import type {} from '@deepseek-ai/dsh-environments'
import type { EnvironmentId } from '@deepseek-ai/dsh-environments/types'
// Type-only: resolves ctx.fleet.
import type {} from '@deepseek-ai/dsh-fleet'
import type { FleetRunReport } from '@deepseek-ai/dsh-fleet/types'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { TrajectorySink } from '@deepseek-ai/dsh-trajectories/types'
import { foldExperiment } from './fold.ts'
import { experimentGroup, planDigest, projectedTokens } from './plan.ts'
import type { ExperimentArm, ExperimentArms, ExperimentPlan, ExperimentResult, ExperimentThresholds } from './types.ts'

export type * from './types.ts'
export { foldExperiment } from './fold.ts'
export type { ExperimentFoldRequest } from './fold.ts'
export {
  EXPERIMENT_ARM_ROLES,
  EXPERIMENT_GROUP_PREFIX,
  experimentGroup,
  parseExperimentGroup,
  planDigest,
  projectedTokens,
} from './plan.ts'
export { bootstrapIntervals } from './statistics.ts'
export type { BootstrapRequest, BootstrapResult, DeltaStratum } from './statistics.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    experiments: ExperimentService
  }
}

/** Stable error codes of a refused plan. */
export type ExperimentErrorCode = 'EXPERIMENT_INVALID_PLAN' | 'EXPERIMENT_PLAN_NOT_FROZEN' | 'EXPERIMENT_OVER_BUDGET'

/** Error returned by the experiment boundary for a plan that cannot run. */
export class ExperimentError extends HarnessError {
  /**
   * @param message - human-readable reason.
   * @param code - stable machine-routable classification.
   */
  // Keep the constructor to narrow HarnessError's string code at this boundary.
  // oxlint-disable-next-line typescript/no-useless-constructor -- type-only narrowing
  constructor(message: string, code: ExperimentErrorCode) {
    super(message, code)
  }
}

/** Deployment choices of the experiment service, validated from `cordis.yml`. */
export interface Config {
  /** Resamples drawn per bootstrap interval. */
  bootstrapResamples?: number
  /** Coverage of every reported interval, between `0` and `1`. */
  confidenceLevel?: number
  /** Certificate-rate delta the overall interval's lower bound must exceed to promote. */
  minimumDelta?: number
  /** Tokens one cell may spend; the plan's projection multiplies it by every cell of both arms. */
  cellTokenCap: number
  /** Tokens one plan's projection may reach; a plan projecting more is refused before it starts. */
  tokenBudget: number
}

/** The experiment service's choices with every default applied. */
export interface ResolvedConfig {
  /** The statistical choices the plan digest freezes. */
  readonly thresholds: ExperimentThresholds
  /** Tokens one plan's projection may reach; a deployment ceiling, outside the digest. */
  readonly tokenBudget: number
}

/**
 * Apply the experiment service's defaults to a validated config.
 * @param config - validated deployment config; the two token fields carry no default.
 * @returns the frozen thresholds and the deployment's token budget.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  return {
    thresholds: {
      bootstrapResamples: config.bootstrapResamples ?? 1000,
      confidenceLevel: config.confidenceLevel ?? 0.95,
      minimumDelta: config.minimumDelta ?? 0,
      cellTokenCap: config.cellTokenCap,
    },
    tokenBudget: config.tokenBudget,
  }
}

/** Experiments (`ctx.experiments`): a frozen, paired, budgeted comparison of two arms. */
export class ExperimentService extends Service {
  static inject = ['environments', 'fleet']

  static Config: z<Config> = z.object({
    bootstrapResamples: z.natural().min(1).default(1000),
    confidenceLevel: z.number().min(0).max(1).default(0.95),
    minimumDelta: z.number().default(0),
    cellTokenCap: z.natural().min(1).required(),
    tokenBudget: z.natural().min(1).required(),
  })

  private readonly resolved: ResolvedConfig

  constructor(ctx: Context, config: Config) {
    super(ctx, 'experiments')
    this.resolved = resolveConfig(config)
  }

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
  async run(plan: ExperimentPlan): Promise<ExperimentResult> {
    const digest = this.freeze(plan)
    const arms: ExperimentArms = {
      baseline: { model: plan.baseline, group: experimentGroup(digest, 'baseline') },
      candidate: { model: plan.candidate, group: experimentGroup(digest, 'candidate') },
    }
    const baseline = await this.runArm(plan, arms.baseline)
    const candidate = await this.runArm(plan, arms.candidate)
    const result = foldExperiment({
      digest,
      arms,
      environments: plan.environments,
      repetitions: plan.repetitions,
      thresholds: this.resolved.thresholds,
      baseline,
      candidate,
    })
    await record(result, plan.sink)
    return result
  }

  /** Validate the plan, compute its digest, and check the projection against the budget. */
  private freeze(plan: ExperimentPlan): string {
    if (!Number.isInteger(plan.repetitions) || plan.repetitions < 1) {
      throw new ExperimentError(`repetitions must be a positive integer, got ${String(plan.repetitions)}`, 'EXPERIMENT_INVALID_PLAN')
    }
    if (plan.environments.length === 0) throw new ExperimentError('the plan names no environment', 'EXPERIMENT_INVALID_PLAN')
    const named = new Set<EnvironmentId>()
    for (const environment of plan.environments) {
      if (named.has(environment)) throw new ExperimentError(`environment "${environment}" is named twice`, 'EXPERIMENT_INVALID_PLAN')
      if (this.ctx.environments.get(environment) === undefined) {
        throw new ExperimentError(`environment "${environment}" is not registered`, 'EXPERIMENT_INVALID_PLAN')
      }
      named.add(environment)
    }
    const digest = planDigest(plan, this.resolved.thresholds)
    if (plan.digest !== undefined && plan.digest !== digest) {
      throw new ExperimentError(`the plan declares digest ${plan.digest} but freezes to ${digest}`, 'EXPERIMENT_PLAN_NOT_FROZEN')
    }
    const projected = projectedTokens(plan, this.resolved.thresholds.cellTokenCap)
    if (projected > this.resolved.tokenBudget) {
      throw new ExperimentError(`the plan projects ${projected} tokens over a budget of ${this.resolved.tokenBudget}`, 'EXPERIMENT_OVER_BUDGET')
    }
    return digest
  }

  /** Run one arm as one fleet run over the plan's environments under the arm's group. */
  private async runArm(plan: ExperimentPlan, arm: ExperimentArm): Promise<FleetRunReport> {
    return this.ctx.fleet.run({
      environments: { ids: plan.environments },
      models: [arm.model],
      repetitions: plan.repetitions,
      workspaceRoot: plan.workspaceRoot,
      group: arm.group,
      ...plan.signal === undefined ? {} : { signal: plan.signal },
    })
  }
}

/** Write the result as one JSON line and close the sink exactly once. */
async function record(result: ExperimentResult, sink?: TrajectorySink): Promise<void> {
  if (sink === undefined) return
  try {
    await sink.write(`${JSON.stringify(result)}\n`)
  } finally {
    await sink.close()
  }
}

export default ExperimentService
