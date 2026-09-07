/**
 * `ctx.scorekeeper` over a real persistence backend: one facts record per
 * session, a scoreboard folded from every persisted log, a JSONL export whose
 * sink closes exactly once, and the `sessionFacts` projection unit that appears
 * only beside a projection registry and disappears with the service fiber.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { jsonlFileSink } from '@deepseek-ai/dsh-trajectories'
import type { TrajectorySink } from '@deepseek-ai/dsh-trajectories'
import ScorekeeperService, { resolveConfig } from '@deepseek-ai/dsh-scorekeeper'
import type { SessionFacts, SessionFactsRecord } from '@deepseek-ai/dsh-scorekeeper'
import { append, cellLog, certificate, goalChange, header, Log, runRecord, standard, stamp } from './log.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** The store, a JSONL backend under a fresh root, and the scorekeeper. */
async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-scorekeeper-'))
  roots.push(root)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await ctx.plugin(ScorekeeperService, { passAtK: [1, 2] })
  return { ctx, root }
}

/** Store one session's log under the backend. */
async function persist(ctx: Context, id: string, events: ReturnType<typeof cellLog>): Promise<void> {
  const meta: SessionHeader = header(id)
  await ctx.sessionPersistence.create(meta)
  await ctx.sessionPersistence.append(meta.id, events)
}

/** Two certified round-trip cells of one batch plus one uncertified cell of another environment. */
async function persistFleet(ctx: Context): Promise<void> {
  await persist(ctx, 'rt-0', cellLog({ stamp: stamp({ group: 'batch-1', repetition: 0 }), certified: true, runs: 1 }))
  await persist(ctx, 'rt-1', cellLog({ stamp: stamp({ group: 'batch-1', repetition: 1 }), certified: true, runs: 1 }))
  await persist(ctx, 'un-0', cellLog({
    stamp: stamp({ group: 'batch-1', repetition: 0, environmentId: 'smoke:unsatisfiable' }),
    certified: false,
    runs: 2,
  }))
}

/** A sink that keeps its lines in memory and counts its closes. */
function memorySink(): TrajectorySink & { lines: string[]; closed: number } {
  const sink = {
    lines: [] as string[],
    closed: 0,
    write(line: string) { sink.lines.push(line) },
    close() { sink.closed += 1 },
  }
  return sink
}

describe('resolveConfig', () => {
  it('estimates pass@1 alone by default and sorts and de-duplicates a configured list', () => {
    expect(resolveConfig({})).toEqual({ passAtK: [1] })
    expect(resolveConfig({ passAtK: [8, 1, 8] })).toEqual({ passAtK: [1, 8] })
  })
})

describe('ScorekeeperService', () => {
  it('folds one persisted session into its facts record and rejects an unreadable one', async () => {
    const { ctx } = await harness()
    await persist(ctx, 'certified', cellLog({ stamp: stamp({ group: 'batch-1' }), certified: true, runs: 1 }))
    const facts = await ctx.scorekeeper.facts(SessionId('certified'))
    expect(facts.identity).toMatchObject({ sessionId: 'certified', createdAt: 500 })
    expect(facts.identity.environment).toMatchObject({ environmentId: 'smoke:round-trip', group: 'batch-1' })
    expect(facts.outcome).toMatchObject({ reward: 1, certified: true, runsRecorded: 1 })
    expect(facts.efficiency.inputTokens).toBe(12)
    await expect(ctx.scorekeeper.facts(SessionId('missing'))).rejects.toThrow()
  })

  it('folds a scoreboard from every persisted log and reports the sessions it could not read', async () => {
    const { ctx } = await harness()
    await persistFleet(ctx)
    const batch = await ctx.scorekeeper.leaderboard()
    expect(batch).toMatchObject({ sessions: 3, excluded: 0, unstamped: 0, skipped: [] })
    expect(batch.computedAt).toBeGreaterThan(0)
    expect(batch.rows.map(row => [row.environmentId, row.runs, row.certified, row.certificateRate, row.attemptsMean]))
      .toEqual([['smoke:round-trip', 2, 2, 1, 1], ['smoke:unsatisfiable', 1, 0, 0, 2]])
    expect(batch.rows[0]?.stats).toEqual({
      groups: 1,
      samples: 2,
      passAtK: [{ k: 1, value: 1, groups: 1 }, { k: 2, value: 1, groups: 1 }],
    })

    const named = await ctx.scorekeeper.leaderboard({ sessions: [SessionId('rt-0'), SessionId('gone')] })
    expect(named.sessions).toBe(2)
    expect(named.skipped).toHaveLength(1)
    expect(named.skipped[0]?.sessionId).toBe('gone')
    expect(named.rows).toHaveLength(1)
  })

  it('counts a session no runner stamped instead of inventing a row for it', async () => {
    const { ctx } = await harness()
    const log = new Log()
    log.assistant({ inputTokens: 2, outputTokens: 1 })
    await persist(ctx, 'bare', log.events)
    expect(await ctx.scorekeeper.leaderboard()).toMatchObject({ sessions: 1, unstamped: 1, rows: [] })
  })

  it('writes one JSONL line per session and closes the sink exactly once', async () => {
    const { ctx, root } = await harness()
    await persistFleet(ctx)
    const sink = memorySink()
    expect(await ctx.scorekeeper.exportFacts({ sink })).toMatchObject({ sessions: 3, exported: 3, skipped: [] })
    expect(sink.closed).toBe(1)
    expect(sink.lines.every(line => line.endsWith('\n'))).toBe(true)
    expect(sink.lines.map(line => (JSON.parse(line) as SessionFactsRecord).identity.sessionId))
      .toEqual(['rt-0', 'rt-1', 'un-0'])

    const path = join(root, 'facts.jsonl')
    await ctx.scorekeeper.exportFacts({ sessions: [SessionId('rt-0'), SessionId('gone')], sink: jsonlFileSink(path) })
    expect((await readFile(path, 'utf8')).trimEnd().split('\n')).toHaveLength(1)

    let closed = 0
    const failing: TrajectorySink = {
      write() { throw new Error('disk full') },
      close() { closed += 1 },
    }
    await expect(ctx.scorekeeper.exportFacts({ sink: failing })).rejects.toThrow('disk full')
    expect(closed).toBe(1)
  })

  it('reports a backend rejection that is not an Error by its string form', async () => {
    class RejectingPersistence extends Service {
      constructor(ctx: Context) {
        super(ctx, 'sessionPersistence')
      }

      list(): Promise<SessionHeader[]> {
        return Promise.resolve([header('broken')])
      }

      inspect(): Promise<never> {
        // A backend rejecting with a bare string is the non-Error path the report must still render.
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the string rejection is the case under test
        return Promise.reject('artifact unreadable')
      }
    }
    const ctx = new Context()
    await ctx.plugin(RejectingPersistence)
    await ctx.plugin(ScorekeeperService)
    expect(await ctx.scorekeeper.leaderboard()).toMatchObject({
      sessions: 1,
      rows: [],
      skipped: [{ sessionId: 'broken', reason: 'artifact unreadable' }],
    })
  })
})

describe('the sessionFacts projection unit', () => {
  /** The store, a backend, the projection registry, and the scorekeeper over a fresh session. */
  async function projected() {
    const root = await mkdtemp(join(tmpdir(), 'dsh-scorekeeper-projection-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    await ctx.plugin(SessionProjectionRegistry)
    const fiber = await ctx.plugin(ScorekeeperService)
    const session = ctx.sessions.create(SessionId('live'))
    const value = (): SessionFacts | undefined => ctx.sessionProjections.snapshot(session).values.sessionFacts
    return { ctx, session, fiber, value }
  }

  it('serves the live facts and keeps a rejected change from tearing them', async () => {
    const bench = await projected()
    append(bench.session, 'environment/run', stamp({ group: 'batch-1' }))
    expect(bench.value()?.identity.environment).toMatchObject({ environmentId: 'smoke:round-trip', group: 'batch-1' })

    append(bench.session, 'goal/change', goalChange('create', 'active', 1))
    append(bench.session, 'verification/standard', standard())
    append(bench.session, 'verification/certificate', certificate())
    expect(bench.value()?.outcome).toMatchObject({ reward: 1, certified: true, certificateRevision: 1 })

    // The strict fold numbers the standard's next run 1, so this change is
    // refused and the served value stays at the last accepted one.
    append(bench.session, 'verification/run', runRecord(5, 'pass'))
    expect(bench.value()?.outcome).toMatchObject({ reward: 1, certified: true, runsRecorded: 0 })

    // The delegated implementer's own account survives the wire schema.
    append(bench.session, 'environment/delegation', {
      attempt: 1,
      provider: 'claude-code',
      runId: 'child-1',
      stopReason: 'completed',
      reportedModel: 'product-sonnet-2026-01',
      reportedUsage: { inputTokens: 31, outputTokens: 7 },
      reportedCostUsd: 0.04,
    })
    expect(bench.value()?.identity.implementerModel).toBe('product-sonnet-2026-01')
    expect(bench.value()?.efficiency.delegated)
      .toEqual({ inputTokens: 31, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.04 })
  })

  it('omits the key without the service and drops it when the service fiber is disposed', async () => {
    const bare = new Context()
    await bare.plugin(SessionStore)
    await bare.plugin(SessionProjectionRegistry)
    const bareSession = bare.sessions.create(SessionId('bare'))
    expect(Object.keys(bare.sessionProjections.snapshot(bareSession).values)).not.toContain('sessionFacts')

    const bench = await projected()
    expect(bench.value()).toBeDefined()
    await bench.fiber.dispose()
    expect(bench.value()).toBeUndefined()
  })
})
