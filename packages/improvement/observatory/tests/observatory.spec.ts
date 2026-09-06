/**
 * `ctx.observatory` over a real persistence backend and a real scorekeeper: one
 * fold over every persisted session, the configured districts and the held-out
 * split withheld from the public rows and counted, the newest folded session's
 * creation time recorded, and both faces rendered from the same snapshot.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import ScorekeeperService from '@deepseek-ai/dsh-scorekeeper'
import ObservatoryService from '@deepseek-ai/dsh-observatory'
import { experiment } from './row.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** The store, a JSONL backend under a fresh root, the scorekeeper, and the observatory. */
async function harness(): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-observatory-'))
  roots.push(root)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await ctx.plugin(ScorekeeperService, { passAtK: [1] })
  await ctx.plugin(ObservatoryService, {
    withhold: { districts: ['workshop'], heldOut: true },
    staleAfterMs: 60_000,
    refreshIntervalMs: 900_000,
  })
  return ctx
}

/** One stamped, certified session log on the named route, district, and split. */
function log(options: {
  readonly model: string
  readonly district?: string
  readonly heldOut?: boolean
}): SessionEvent[] {
  const events: { type: string; data: unknown }[] = [
    {
      type: 'environment/run',
      data: {
        kind: 'environment/run',
        version: 1,
        environmentId: 'smoke:round-trip',
        environmentKind: 'smoke',
        heldOut: options.heldOut ?? false,
        promptSha256: 'c'.repeat(64),
        checksSha256: 'c'.repeat(64),
        contentSha256: 'c'.repeat(64),
        repetition: 0,
        ...options.district === undefined ? {} : { district: options.district },
        model: { provider: 'cli-mock', model: options.model },
        isolation: 'none',
      },
    },
    {
      type: 'goal/change',
      data: {
        kind: 'goal/change',
        version: 1,
        operation: 'create',
        goal: { id: 'goal-1', revision: 1, objective: 'Prove the fold', phase: 'active', maxGoalRounds: 7 },
        roundsStarted: 0,
        createdAt: 10,
        updatedAt: 11,
      },
    },
    {
      type: 'verification/standard',
      data: {
        kind: 'verification/standard',
        version: 1,
        operation: 'author',
        standard: {
          id: 'standard-1',
          revision: 1,
          goalId: 'goal-1',
          checks: [{ id: 'round-trip', outcome: 'the round trip prints', run: 'printf X' }],
          relaxed: [],
        },
        createdAt: 11,
        updatedAt: 11,
      },
    },
    {
      type: 'verification/run',
      data: {
        kind: 'verification/run',
        version: 1,
        standard: { id: 'standard-1', revision: 1 },
        attempt: 1,
        isolation: 'none',
        executor: 'runner',
        verdict: 'passed',
        results: [{ checkId: 'round-trip', status: 'pass', evidence: 'pass round-trip' }],
        recordedAt: 21,
      },
    },
    {
      type: 'verification/certificate',
      data: {
        kind: 'verification/certificate',
        version: 1,
        certificate: {
          standard: { id: 'standard-1', revision: 1 },
          goalId: 'goal-1',
          isolation: 'none',
          executor: 'runner',
          results: [{ checkId: 'round-trip', status: 'pass', evidence: 'pass round-trip' }],
          recordedAt: 30,
        },
      },
    },
  ]
  return events.map((event, index) => ({ ...event, seq: index, time: 1000 + index }) as unknown as SessionEvent)
}

/** Store one session's header and log under the backend. */
async function persist(ctx: Context, id: string, createdAt: number, events: SessionEvent[]): Promise<void> {
  const meta: SessionHeader = { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt }
  await ctx.sessionPersistence.create(meta)
  await ctx.sessionPersistence.append(meta.id, events)
}

describe('ObservatoryService', () => {
  it('folds every persisted session, withholds the configured districts and the held-out split, and counts both', async () => {
    const ctx = await harness()
    await persist(ctx, 'public-0', 4000, log({ model: 'public' }))
    await persist(ctx, 'workshop-0', 5000, log({ model: 'client', district: 'workshop' }))
    await persist(ctx, 'reserved-0', 3000, log({ model: 'public', heldOut: true }))

    const snapshot = await ctx.observatory.snapshot()
    expect(snapshot.rows.map(row => [row.model, row.district, row.heldOut])).toEqual([['public', undefined, false]])
    expect(snapshot.withheld).toEqual({
      districts: ['workshop'],
      districtRows: 1,
      districtSessions: 1,
      heldOutRows: 1,
      heldOutSessions: 1,
    })
    expect(snapshot).toMatchObject({ sessions: 3, unstamped: 0, skipped: [], refreshIntervalMs: 900_000 })
    // The newest folded header decides staleness, whichever district it came from.
    expect(snapshot.newestSessionAt).toBe(5000)
    expect(snapshot.foldedAt).toBeGreaterThan(0)
    await ctx.fiber.dispose()
  })

  it('states no newest session and publishes nothing for an empty store', async () => {
    const ctx = await harness()
    const snapshot = await ctx.observatory.snapshot()
    expect(snapshot).not.toHaveProperty('newestSessionAt')
    expect(snapshot.rows).toEqual([])
    expect(ctx.observatory.render(snapshot, 0).json.stale).toBe(true)
    await ctx.fiber.dispose()
  })

  it('renders both faces of one publication from the same snapshot', async () => {
    const ctx = await harness()
    await persist(ctx, 'public-0', 4000, log({ model: 'public' }))
    const snapshot = await ctx.observatory.snapshot()
    const page = ctx.observatory.render(snapshot, 4000 + 60_000)
    expect(page.json).toMatchObject({ stale: false, staleAfterMs: 60_000, refreshIntervalMs: 900_000 })
    expect(page.json.rows.map(row => row.model)).toEqual(['public'])
    expect(page.html).toContain('cli-mock/public')
    expect(ctx.observatory.render(snapshot, 4000 + 60_001).json.stale).toBe(true)
    await ctx.fiber.dispose()
  })

  it('publishes only the verdicts whose two arm routes both survive withholding', async () => {
    const ctx = await harness()
    await persist(ctx, 'left-0', 4000, log({ model: 'left' }))
    await persist(ctx, 'right-0', 4100, log({ model: 'right' }))
    await persist(ctx, 'workshop-0', 4200, log({ model: 'client', district: 'workshop' }))

    const published = await ctx.observatory.snapshot({
      experiments: [experiment('left', 'right', 'promote'), experiment('left', 'client', 'promote')],
    })
    expect(published.experiments.map(result => result.arms.candidate.model.model)).toEqual(['right'])
    expect((await ctx.observatory.snapshot()).experiments).toEqual([])
    await ctx.fiber.dispose()
  })
})
