/**
 * Freezing one experiment plan: the content digest computed before any cell
 * runs, and the stamp `group` each arm's sessions carry so a later fold can
 * find them in the logs.
 *
 * @module @deepseek-ai/dsh-experiments/plan
 */

import { createHash } from 'node:crypto'
import type { ExperimentArmRole, ExperimentPlan, ExperimentThresholds } from './types.ts'

/**
 * Group namespace this package owns. A `group` starting with it names an
 * experiment arm, so no other producer may mint one.
 */
export const EXPERIMENT_GROUP_PREFIX = 'experiment-'

/** Self-declared version of the digested plan fields; a change to what they cover changes it. */
const EXPERIMENT_PLAN_VERSION = 2

/** Arm roles in the order the digest and the runs take them. */
export const EXPERIMENT_ARM_ROLES: readonly ExperimentArmRole[] = ['baseline', 'candidate']

const GROUP_PATTERN = new RegExp(`^${EXPERIMENT_GROUP_PREFIX}([0-9a-f]{64})-(${EXPERIMENT_ARM_ROLES.join('|')})$`)

/**
 * Content digest of the fields that decide what an experiment measures: the
 * two arm routes in role order, the environment ids sorted so a caller's
 * listing order cannot change the identity, the repetition count, the policy
 * version and base seed both arms ran under, and the thresholds. The
 * deployment's token budget is deliberately absent: it bounds what a
 * deployment pays for, not what the comparison measures. The policy version
 * and the seed are present because both arms' sessions are found in the logs
 * by the groups this digest mints, so two comparisons that differ in either
 * must not collide on one group.
 * @param plan - the arms, environments, repetitions, policy version, and seed to freeze.
 * @param thresholds - the resolved statistical choices to freeze with them.
 * @returns the SHA-256 hex digest; identical inputs give identical digests.
 */
export function planDigest(plan: ExperimentPlan, thresholds: ExperimentThresholds): string {
  const content = JSON.stringify({
    version: EXPERIMENT_PLAN_VERSION,
    arms: EXPERIMENT_ARM_ROLES.map(role => [role, plan[role].provider, plan[role].model]),
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
  })
  return createHash('sha256').update(content).digest('hex')
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
