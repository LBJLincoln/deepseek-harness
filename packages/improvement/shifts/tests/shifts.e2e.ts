/**
 * Keyless REAL-composition coverage for the durable shift loop: three boots of
 * one `cordis.yml` over one persistence root. The first runs a district's slot
 * to completion; the second opens a fresh slot and dies on its first announced
 * cell; the third resumes that shift, records the orphan, runs only the cell
 * that never started, and closes the ledger.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { ShiftEnd, ShiftResume, ShiftStart } from '@deepseek-ai/dsh-shifts'

const binScript = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/shift-driver/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/shift-driver/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

/** Three boots, each a full mock-model shift, need more than the default window. */
const PHASE_TIMEOUT_MS = 120_000
const KILLED = 9
const NIGHT_SHIFT = 'nightshift'

interface LedgerLine {
  sessionId: string
  events: { type: string; data: unknown }[]
}

interface StampLine {
  sessionId: string
  group?: string
  district?: string
  environmentId: string
  repetition: number
}

interface DriverResult {
  type: string
  ledgers: LedgerLine[]
  stamps: StampLine[]
}

const roots: string[] = []

afterAll(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** Boot the driver once over the shared persistence root. */
async function phase(root: string, env: Record<string, string>, expectedExitCode = 0): Promise<string> {
  const { stdout, stderr } = await runLoaderSmoke({
    label: `shift-driver (${JSON.stringify(env)})`,
    tempDirPrefix: 'shift-driver-e2e-',
    binScript,
    libBinScript: binScript,
    configPath,
    binArgs: [configPath],
    tsconfigPath: repoTsconfig,
    processTimeoutMs: PHASE_TIMEOUT_MS,
    expectedExitCode,
    env: { DSH_TEST_SESSION_ROOT: root, ...env },
  })
  expect(stderr).toBe('')
  return stdout
}

/** Run stamps in environment order; the backend lists sessions in its own. */
function byEnvironment(stamps: readonly StampLine[]): StampLine[] {
  return [...stamps].sort((left, right) => left.environmentId.localeCompare(right.environmentId))
}

/** The last JSON line the driver printed. */
function result(stdout: string): DriverResult {
  const parsed = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as DriverResult
  expect(parsed.type).toBe('result')
  return parsed
}

describe('the shift driver through a real cordis.yml, killed and restarted', () => {
  it('runs a slot, resumes the shift a kill interrupted, and never runs a recorded cell twice', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shift-driver-sessions-'))
    roots.push(root)

    const first = result(await phase(root, {}))
    expect(first.ledgers).toHaveLength(1)
    const workshop = first.ledgers[0] as LedgerLine
    expect(workshop.events.map(event => event.type)).toEqual(['shift/start', 'shift/cell', 'shift/cell', 'shift/end'])
    const opened = workshop.events[0]?.data as ShiftStart
    expect(opened.shiftId).toBe(workshop.sessionId)
    expect(opened.plan).toMatchObject({
      district: 'workshop',
      environments: ['smoke:round-trip', 'smoke:unsatisfiable'],
      repetitions: 1,
    })
    expect(workshop.events.at(-1)?.data).toMatchObject({
      shiftId: workshop.sessionId,
      outcome: 'completed',
      cells: { reported: 2, error: 0, interrupted: 0 },
    })
    expect((workshop.events.at(-1)?.data as ShiftEnd).spend).toBeGreaterThan(0)
    expect(byEnvironment(first.stamps).map(stamp => [stamp.environmentId, stamp.group, stamp.district])).toEqual([
      ['smoke:round-trip', workshop.sessionId, 'workshop'],
      ['smoke:unsatisfiable', workshop.sessionId, 'workshop'],
    ])

    // The second boot opens a fresh slot of its own district and dies on the
    // first announced cell, before the ledger records it.
    await phase(root, { DSH_TEST_SHIFT_DISTRICT: NIGHT_SHIFT, DSH_TEST_SHIFT_KILL_AFTER_CELL: '1' }, KILLED)

    const third = result(await phase(root, { DSH_TEST_SHIFT_DISTRICT: NIGHT_SHIFT }))
    const night = third.ledgers.find(ledger => ledger.sessionId !== workshop.sessionId) as LedgerLine
    expect(third.ledgers).toHaveLength(2)
    expect(night.events.map(event => event.type)).toEqual([
      'shift/start', 'shift/cell', 'shift/resume', 'shift/cell', 'shift/end',
    ])
    // The resumed shift keeps the identity the killed process froze.
    expect((night.events[0]?.data as ShiftStart).shiftId).toBe(night.sessionId)
    expect((night.events[0]?.data as ShiftStart).plan.district).toBe(NIGHT_SHIFT)

    const orphan = night.events[1]?.data as {
      cell: { environment: string }
      outcome: { kind: string }
      sessionId: string
    }
    expect(orphan.outcome).toEqual({ kind: 'interrupted' })
    expect(orphan.cell.environment).toBe('smoke:round-trip')
    const resumed = night.events[2]?.data as ShiftResume
    expect(resumed.done.map(cell => cell.environment)).toEqual(['smoke:round-trip'])
    expect(resumed.pending.map(cell => cell.environment)).toEqual(['smoke:unsatisfiable'])
    expect(night.events[3]?.data).toMatchObject({
      shiftId: night.sessionId,
      cell: { environment: 'smoke:unsatisfiable', repetition: 0 },
      outcome: { kind: 'reported' },
    })
    expect(night.events.at(-1)?.data).toMatchObject({
      outcome: 'completed',
      cells: { reported: 1, error: 0, interrupted: 1 },
    })

    // Every cell of the night shift has exactly one session, and the orphan's
    // is the one the killed process created.
    const nightStamps = byEnvironment(third.stamps.filter(stamp => stamp.group === night.sessionId))
    expect(nightStamps.map(stamp => [stamp.environmentId, stamp.repetition, stamp.district])).toEqual([
      ['smoke:round-trip', 0, NIGHT_SHIFT],
      ['smoke:unsatisfiable', 0, NIGHT_SHIFT],
    ])
    expect(orphan.sessionId).toBe(nightStamps[0]?.sessionId)
    // The workshop district was not configured for the later boots, so its
    // completed shift is untouched and no second slot of it exists.
    expect(third.stamps.filter(stamp => stamp.district === 'workshop')).toHaveLength(2)
  }, PHASE_TIMEOUT_MS * 3 + LOADER_SMOKE_TEST_TIMEOUT_MS)
})
