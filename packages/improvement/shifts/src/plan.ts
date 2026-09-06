/**
 * Freezing one shift: the content digest computed before any cell runs, the
 * shift instance id derived from it and the slot time, and the cell
 * enumeration both the ledger and the fleet run take.
 *
 * @module @deepseek-ai/dsh-shifts/plan
 */

import { createHash } from 'node:crypto'
import type { FleetCell } from '@deepseek-ai/dsh-fleet/types'
import type { ShiftPlan } from './types.ts'

/**
 * Group namespace this package owns. A stamp `group` starting with it names a
 * shift, so no other producer may mint one.
 */
export const SHIFT_ID_PREFIX = 'shift-'

/** Self-declared version of the digested plan fields; a change to what they cover changes it. */
const SHIFT_PLAN_VERSION = 2

const SHIFT_ID_PATTERN = new RegExp(`^${SHIFT_ID_PREFIX}([0-9a-f]{64})-(0|[1-9][0-9]*)$`)

/**
 * Content digest of the fields that decide what a shift runs: the district,
 * the environment ids sorted by code unit so a registry listing order cannot
 * change the identity, the model routes in listing order because the fleet
 * enumerates cells in it, the repetition count, the policy version and base
 * seed the cells sample under, and the token ceiling. The workspace root, the
 * cadence, and the spend window are deployment choices and stay out: they
 * decide what a deployment pays for, not what the shift runs.
 * @param plan - the frozen plan to digest.
 * @returns the SHA-256 hex digest; identical inputs give identical digests.
 */
export function shiftDigest(plan: ShiftPlan): string {
  const content = JSON.stringify({
    version: SHIFT_PLAN_VERSION,
    district: plan.district,
    environments: [...plan.environments].sort(),
    models: plan.models.map(model => [model.provider, model.model]),
    repetitions: plan.repetitions,
    policyVersion: plan.policyVersion ?? null,
    seed: plan.seed ?? null,
    tokenCeiling: plan.tokenCeiling ?? null,
  })
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Identity of one shift instance, and the stamp `group` every cell of it
 * carries. Two processes that compute the same slot compute the same identity
 * without counting anything, so a restart resumes a shift instead of minting a
 * second one.
 * @param digest - the frozen plan digest.
 * @param scheduledAt - the slot time in epoch milliseconds.
 * @returns `shift-<digest>-<scheduledAt>`.
 */
export function shiftId(digest: string, scheduledAt: number): string {
  return `${SHIFT_ID_PREFIX}${digest}-${scheduledAt}`
}

/**
 * Read an id minted by {@link shiftId}.
 * @param id - a stamp `group` or a shift session id.
 * @returns the digest and slot time, or `undefined` for an id outside this
 *   package's namespace or malformed inside it.
 */
export function parseShiftId(id: string): { digest: string; scheduledAt: number } | undefined {
  const match = SHIFT_ID_PATTERN.exec(id)
  if (match === null) return undefined
  return { digest: match[1] as string, scheduledAt: Number(match[2]) }
}

/**
 * Every cell of a frozen plan, in the order the fleet enumerates them:
 * environment-major, then model route, then repetition from zero.
 * @param plan - the frozen plan to enumerate.
 * @returns the cells in plan order.
 */
export function shiftCells(plan: ShiftPlan): FleetCell[] {
  const cells: FleetCell[] = []
  for (const environment of plan.environments) {
    for (const model of plan.models) {
      for (let repetition = 0; repetition < plan.repetitions; repetition += 1) cells.push({ environment, model, repetition })
    }
  }
  return cells
}

/**
 * The slot a district opens next.
 *
 * Slots form an arithmetic sequence anchored on the district's previous
 * `shift/start`, so a restart neither drifts nor doubles a slot; slots that
 * passed while no process ran are skipped rather than caught up, and the hole
 * stays visible from the arithmetic. A district with no slot yet opens one now
 * when the deployment asked to start immediately, and one interval out
 * otherwise.
 * @param previous - the district's previous slot time, absent when it has none.
 * @param intervalMs - milliseconds between consecutive slots.
 * @param now - the current epoch milliseconds.
 * @param startImmediately - whether a district without a slot opens one now.
 * @returns the next slot time in epoch milliseconds.
 */
export function nextSlotAt(
  previous: number | undefined,
  intervalMs: number,
  now: number,
  startImmediately: boolean,
): number {
  if (previous === undefined) return startImmediately ? now : now + intervalMs
  const elapsed = now - previous
  const skipped = elapsed < 0 ? 0 : Math.floor(elapsed / intervalMs)
  return previous + (skipped + 1) * intervalMs
}
