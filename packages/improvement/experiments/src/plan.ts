/**
 * Freezing one experiment plan: the content digest computed before any cell
 * runs, and the stamp `group` each arm's sessions carry so a later fold can
 * find them in the logs.
 *
 * @module @deepseek-ai/dsh-experiments/plan
 */

import { createHash } from 'node:crypto'
import type { BudgetCap } from '@deepseek-ai/dsh-budget-policy'
import type { EnvironmentRunImplementer } from '@deepseek-ai/dsh-environment-runner/types'
import { assertNever } from '@deepseek-ai/dsh-llm'
import type { ExperimentArmPlan, ExperimentArmRole, ExperimentPlan, ExperimentThresholds } from './types.ts'

/**
 * Group namespace this package owns. A `group` starting with it names an
 * experiment arm, so no other producer may mint one.
 */
export const EXPERIMENT_GROUP_PREFIX = 'experiment-'

/** Self-declared version of the digested plan fields; a change to what they cover changes it. */
const EXPERIMENT_PLAN_VERSION = 4

/** Arm roles in the order the digest and the runs take them. */
export const EXPERIMENT_ARM_ROLES: readonly ExperimentArmRole[] = ['baseline', 'candidate']

const GROUP_PATTERN = new RegExp(`^${EXPERIMENT_GROUP_PREFIX}([0-9a-f]{64})-(${EXPERIMENT_ARM_ROLES.join('|')})$`)

/**
 * The implementer one arm runs under.
 * @param arm - one arm as the plan names it.
 * @returns the named implementer, or the arm's own model route when it names none.
 */
export function armImplementer(arm: ExperimentArmPlan): EnvironmentRunImplementer {
  return arm.implementer ?? { kind: 'route' }
}

/**
 * One implementer as the digest takes it: the discriminant, the subagent
 * provider, and its label, each in a fixed position, so the key order a caller
 * happened to write cannot change the digest.
 */
function digestedImplementer(implementer: EnvironmentRunImplementer): readonly (string | null)[] {
  switch (implementer.kind) {
    case 'route':
      return [implementer.kind, null, null]
    case 'subagent':
      return [implementer.kind, implementer.provider, implementer.label ?? null]
    /* v8 ignore next 2 -- EnvironmentRunImplementer is closed and every member is handled above */
    default:
      return assertNever(implementer, 'arm implementer')
  }
}

/**
 * Content digest of the fields that decide what an experiment measures: the
 * two arms in role order, each with its model route and its implementer, the
 * environment ids sorted so a caller's listing order cannot change the
 * identity, the repetition count, the policy version and base seed both arms
 * ran under, the thresholds, and the caps every cell of both arms ran under.
 * The caps are digested because a cell cut off at one wall or token ceiling
 * measures something different from the same cell cut off at another, so two
 * comparisons run under different budgets are two experiments. The deployment's
 * token budget stays absent: it bounds what a deployment pays for across plans,
 * not what one comparison measures. The policy version and the seed are present
 * because both arms' sessions are found in the logs by the groups this digest
 * mints, so two comparisons that differ in either must not collide on one group.
 * @param plan - the arms, environments, repetitions, policy version, and seed to freeze.
 * @param thresholds - the resolved statistical choices to freeze with them.
 * @param caps - the caps both arms resolve to, in cap evaluation order.
 * @returns the SHA-256 hex digest; identical inputs give identical digests.
 */
export function planDigest(
  plan: ExperimentPlan,
  thresholds: ExperimentThresholds,
  caps: readonly BudgetCap[],
): string {
  const content = JSON.stringify({
    version: EXPERIMENT_PLAN_VERSION,
    arms: EXPERIMENT_ARM_ROLES.map(role => [
      role,
      plan[role].provider,
      plan[role].model,
      digestedImplementer(armImplementer(plan[role])),
    ]),
    environments: [...plan.environments].sort(),
    repetitions: plan.repetitions,
    policyVersion: plan.policyVersion ?? null,
    seed: plan.seed ?? null,
    thresholds: [
      thresholds.bootstrapResamples,
      thresholds.confidenceLevel,
      thresholds.minimumDelta,
      thresholds.cellTokenCap,
    ],
    caps,
  })
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Whether two arms would run their cells under the same ceilings.
 * @param baseline - caps resolved for the baseline arm, in cap evaluation order.
 * @param candidate - caps resolved for the candidate arm, in the same order.
 * @returns `true` when both lists name the same caps at the same values.
 */
export function capsAgree(baseline: readonly BudgetCap[], candidate: readonly BudgetCap[]): boolean {
  return baseline.length === candidate.length
    && baseline.every(([cap, limit], index) => {
      // The length check above makes every index of `baseline` an index of
      // `candidate`, which the element type does not say.
      const [otherCap, otherLimit] = candidate[index] as BudgetCap
      return otherCap === cap && otherLimit === limit
    })
}

/**
 * Render one arm's caps for a diagnostic.
 * @param caps - the caps to render, in cap evaluation order.
 * @returns `cap=limit` pairs separated by commas, or `none` for an uncapped arm.
 */
export function describeCaps(caps: readonly BudgetCap[]): string {
  return caps.length === 0 ? 'none' : caps.map(([cap, limit]) => `${cap}=${limit}`).join(', ')
}

/**
 * Stamp `group` one arm's sessions carry.
 * @param digest - the frozen plan digest.
 * @param role - which arm the group names.
 * @returns `experiment-<digest>-<role>`.
 */
export function experimentGroup(digest: string, role: ExperimentArmRole): string {
  return `${EXPERIMENT_GROUP_PREFIX}${digest}-${role}`
}

/**
 * Read a group minted by {@link experimentGroup}.
 * @param group - a stamp group from an `environment/run` event.
 * @returns the digest and role, or `undefined` for a group outside this package's namespace or malformed inside it.
 */
export function parseExperimentGroup(group: string): { digest: string; role: ExperimentArmRole } | undefined {
  const match = GROUP_PATTERN.exec(group)
  if (match === null) return undefined
  return { digest: match[1] as string, role: match[2] as ExperimentArmRole }
}

/**
 * Tokens a plan may spend at its per-cell cap: every environment, every
 * repetition, on both arms.
 * @param plan - the environments and repetitions to project.
 * @param cellTokenCap - tokens one cell may spend.
 * @returns the projected ceiling the token budget is checked against.
 */
export function projectedTokens(plan: ExperimentPlan, cellTokenCap: number): number {
  return plan.environments.length * plan.repetitions * EXPERIMENT_ARM_ROLES.length * cellTokenCap
}
