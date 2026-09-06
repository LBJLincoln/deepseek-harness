/**
 * Freezing a shift: what the digest covers and what it deliberately ignores,
 * the instance id it names, the cell order the ledger and the fleet share, and
 * the slot arithmetic the cadence reads out of the ledger.
 */

import { describe, expect, it } from 'vitest'
import { nextSlotAt, parseShiftId, SHIFT_ID_PREFIX, shiftCells, shiftDigest, shiftId } from '@deepseek-ai/dsh-shifts'
import { DISTRICT, plan, ROUND_TRIP, ROUTE, UNSATISFIABLE } from './log.ts'

const ROUTE_B = { provider: 'mock', model: 'b' }

describe('shiftDigest', () => {
  it('is stable under environment reordering and moves with every other digested field', () => {
    const digest = shiftDigest(plan())
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
    expect(shiftDigest(plan({ environments: [UNSATISFIABLE, ROUND_TRIP] }))).toBe(digest)
    expect(shiftDigest(plan({ environments: [ROUND_TRIP] }))).not.toBe(digest)
    expect(shiftDigest(plan({ district: 'yard' }))).not.toBe(digest)
    expect(shiftDigest(plan({ repetitions: 2 }))).not.toBe(digest)
    expect(shiftDigest(plan({ models: [ROUTE, ROUTE_B] }))).not.toBe(digest)
    expect(shiftDigest(plan({ tokenCeiling: 10 }))).not.toBe(digest)
    expect(shiftDigest(plan({ tokenCeiling: 11 }))).not.toBe(shiftDigest(plan({ tokenCeiling: 10 })))
    expect(shiftDigest(plan({ policyVersion: 'policy-2026-09' }))).not.toBe(digest)
    expect(shiftDigest(plan({ seed: 0 }))).not.toBe(digest)
    expect(shiftDigest(plan({ seed: 1 }))).not.toBe(shiftDigest(plan({ seed: 0 })))
    expect(shiftDigest(plan({ implementer: { kind: 'route' } }))).not.toBe(digest)
    expect(shiftDigest(plan({ implementer: { kind: 'subagent', provider: 'claude-code' } })))
      .not.toBe(shiftDigest(plan({ implementer: { kind: 'subagent', provider: 'codex' } })))
  })

  it('keeps the routes in listing order, because the cells run in it', () => {
    expect(shiftDigest(plan({ models: [ROUTE, ROUTE_B] })))
      .not.toBe(shiftDigest(plan({ models: [ROUTE_B, ROUTE] })))
  })
})

describe('shiftId', () => {
  it('names one instance per slot and reads its parts back', () => {
    const digest = shiftDigest(plan())
    expect(shiftId(digest, 1_700)).toBe(`${SHIFT_ID_PREFIX}${digest}-1700`)
    expect(parseShiftId(shiftId(digest, 1_700))).toEqual({ digest, scheduledAt: 1_700 })
    expect(parseShiftId(shiftId(digest, 0))).toEqual({ digest, scheduledAt: 0 })
    expect(parseShiftId('fleet-batch-1')).toBeUndefined()
    expect(parseShiftId(`${SHIFT_ID_PREFIX}${digest}-01`)).toBeUndefined()
    expect(parseShiftId(`${SHIFT_ID_PREFIX}not-hex-10`)).toBeUndefined()
  })
})

describe('shiftCells', () => {
  it('enumerates environment-major, then route, then repetition from zero', () => {
    expect(shiftCells(plan({ models: [ROUTE, ROUTE_B], repetitions: 2 }))
      .map(cell => [cell.environment, cell.model.model, cell.repetition]))
      .toEqual([
        [ROUND_TRIP, 'a', 0], [ROUND_TRIP, 'a', 1], [ROUND_TRIP, 'b', 0], [ROUND_TRIP, 'b', 1],
        [UNSATISFIABLE, 'a', 0], [UNSATISFIABLE, 'a', 1], [UNSATISFIABLE, 'b', 0], [UNSATISFIABLE, 'b', 1],
      ])
    expect(shiftCells(plan()).every(cell => cell.model === ROUTE)).toBe(true)
    expect(plan().district).toBe(DISTRICT)
  })
})

describe('nextSlotAt', () => {
  it('opens the first slot now or one interval out, and never catches a missed one up', () => {
    expect(nextSlotAt(undefined, 100, 1_000, true)).toBe(1_000)
    expect(nextSlotAt(undefined, 100, 1_000, false)).toBe(1_100)
    expect(nextSlotAt(1_000, 100, 1_050, true)).toBe(1_100)
    expect(nextSlotAt(1_000, 100, 1_100, true)).toBe(1_200)
    // Slots that passed while no process ran leave the hole visible in the arithmetic.
    expect(nextSlotAt(1_000, 100, 1_450, true)).toBe(1_500)
    // A clock that jumped backwards moves a slot and never doubles one.
    expect(nextSlotAt(1_000, 100, 900, true)).toBe(1_100)
  })
})
