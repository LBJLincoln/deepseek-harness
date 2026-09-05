import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import TrajectoryService, { jsonlFileSink } from '@deepseek-ai/dsh-trajectories'
import type { Trajectory, TrajectorySink } from '@deepseek-ai/dsh-trajectories'
import * as invariantCompanion from '@deepseek-ai/dsh-trajectories/invariant'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-trajectories-'))
  roots.push(root)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await ctx.plugin(TrajectoryService)
  return { ctx, root }
}

const HEX = 'b'.repeat(64)

/** The runner's stamp for a held-out environment, as the log carries it. */
function heldOutStamp(): unknown {
  return {
    kind: 'environment/run', version: 1, environmentId: 'smoke:reserved', environmentKind: 'smoke', heldOut: true,
    promptSha256: HEX, checksSha256: HEX, contentSha256: HEX, repetition: 0,
    model: { provider: 'cli-mock', model: 'cli-mock' }, isolation: 'none',
  }
}

/** A balanced one-step log, certified when `certified` is set, stamped as held out when `heldOut` is set. */
function events(certified: boolean, heldOut = false): SessionEvent[] {
  const raw: unknown[] = [
    ...heldOut ? [{ type: 'environment/run', data: heldOutStamp() }] : [],
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'step/start', data: { turn: 1, step: 1 } },
    { type: 'request/header', data: { header: { config: { provider: 'cli-mock', model: 'cli-mock' } }, reason: 'initial' } },
    { type: 'user/message', data: createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }), surfaceOp: 'append' },
    {
      type: 'goal/change',
      data: {
        kind: 'goal/change', version: 1, operation: 'create',
        goal: { id: 'goal-1', revision: 1, objective: 'go', phase: 'active', maxGoalRounds: 3 },
        roundsStarted: 0, createdAt: 1, updatedAt: 1,
      },
    },
    {
      type: 'verification/standard',
      data: {
        kind: 'verification/standard', version: 1, operation: 'author',
        standard: { id: 'standard-1', revision: 1, goalId: 'goal-1', checks: [{ id: 'done', outcome: 'done', run: 'true' }], relaxed: [] },
        createdAt: 1, updatedAt: 1,
      },
    },
    ...certified ? [{
      type: 'verification/certificate',
      data: {
        kind: 'verification/certificate', version: 1,
        certificate: {
          standard: { id: 'standard-1', revision: 1 }, goalId: 'goal-1', isolation: 'host', executor: 'runner',
          results: [{ checkId: 'done', status: 'pass', evidence: 'true exited 0' }], recordedAt: 2,
        },
      },
    }] : [],
    {
      type: 'assistant/message',
      data: { turn: 1, step: 1, message: createAssistantMessage({ content: [{ type: 'text', text: 'ok' }], source: { provider: 'cli-mock', model: 'cli-mock' } }) },
      surfaceOp: 'append',
      sourceEventSeqs: [],
    },
    { type: 'step/end', data: { turn: 1, step: 1 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  return raw.map((event, seq) => ({ ...event as object, seq, time: 1_000 + seq }) as SessionEvent)
}

async function persist(ctx: Context, id: string, certified: boolean, heldOut = false): Promise<void> {
  const header: SessionHeader = { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 100 }
  await ctx.sessionPersistence.create(header)
  await ctx.sessionPersistence.append(header.id, events(certified, heldOut))
}

function memorySink(): TrajectorySink & { lines: string[]; closed: number } {
  const sink = {
    lines: [] as string[],
    closed: 0,
    write(line: string) { sink.lines.push(line) },
    close() { sink.closed += 1 },
  }
  return sink
}

describe('TrajectoryService', () => {
  it('exports every persisted session, counts the rewarded ones, and closes the sink once', async () => {
    const { ctx } = await harness()
    await persist(ctx, 'certified', true)
    await persist(ctx, 'measured', false)
    const sink = memorySink()
    const report = await ctx.trajectories.export({ sink })
    expect(report).toEqual({ sessions: 2, exported: 2, rewarded: 1, filtered: 0, heldOut: 0, skipped: [] })
    expect(sink.closed).toBe(1)
    const trajectories = sink.lines.map(line => JSON.parse(line) as Trajectory)
    expect(sink.lines.every(line => line.endsWith('\n'))).toBe(true)
    expect(new Map(trajectories.map(trajectory => [trajectory.id, trajectory.reward.outcome]))).toEqual(new Map([
      ['certified', 1],
      ['measured', 0],
    ]))
    expect(trajectories.find(trajectory => trajectory.id === 'certified')?.provenance.isolation).toBe('host')
  })

  it('withholds unrewarded trajectories on request and reports unreadable sessions without aborting', async () => {
    const { ctx } = await harness()
    await persist(ctx, 'certified', true)
    await persist(ctx, 'measured', false)
    const sink = memorySink()
    const report = await ctx.trajectories.export({
      sessions: [SessionId('measured'), SessionId('missing'), SessionId('certified')],
      sink,
      rewardedOnly: true,
    })
    expect(report.sessions).toBe(3)
    expect(report.exported).toBe(1)
    expect(report.rewarded).toBe(1)
    expect(report.filtered).toBe(1)
    expect(report.skipped).toHaveLength(1)
    expect(report.skipped[0]?.sessionId).toBe('missing')
    expect(report.skipped[0]?.reason).toContain('missing')
    expect(sink.lines).toHaveLength(1)
    expect(sink.closed).toBe(1)
  })

  it('withholds held-out sessions unless the request includes them, before the reward filter', async () => {
    const { ctx } = await harness()
    await persist(ctx, 'reserved', true, true)
    await persist(ctx, 'certified', true)
    const withheld = memorySink()
    expect(await ctx.trajectories.export({ sink: withheld, rewardedOnly: true }))
      .toEqual({ sessions: 2, exported: 1, rewarded: 1, filtered: 0, heldOut: 1, skipped: [] })
    expect(withheld.lines.map(line => (JSON.parse(line) as Trajectory).id)).toEqual(['certified'])

    const included = memorySink()
    expect(await ctx.trajectories.export({ sink: included, includeHeldOut: true }))
      .toEqual({ sessions: 2, exported: 2, rewarded: 2, filtered: 0, heldOut: 0, skipped: [] })
    const reserved = included.lines.map(line => JSON.parse(line) as Trajectory).find(trajectory => trajectory.id === 'reserved')
    expect(reserved?.environment).toMatchObject({ environmentId: 'smoke:reserved', heldOut: true })
    expect(reserved?.provenance.components).toContain('environment:smoke:reserved')
  })

  it('returns zero counts over an empty store and closes the sink after a write failure', async () => {
    const { ctx } = await harness()
    const idle = memorySink()
    await expect(ctx.trajectories.export({ sink: idle }))
      .resolves.toEqual({ sessions: 0, exported: 0, rewarded: 0, filtered: 0, heldOut: 0, skipped: [] })
    expect(idle.closed).toBe(1)

    await persist(ctx, 'certified', true)
    let closed = 0
    const failing: TrajectorySink = {
      write() { throw new Error('disk full') },
      close() { closed += 1 },
    }
    await expect(ctx.trajectories.export({ sink: failing })).rejects.toThrow('disk full')
    expect(closed).toBe(1)
  })

  it('reports a backend rejection that is not an Error by its string form', async () => {
    class RejectingPersistence extends Service {
      constructor(ctx: Context) {
        super(ctx, 'sessionPersistence')
      }

      list(): Promise<SessionHeader[]> {
        return Promise.resolve([{ version: SESSION_FORMAT_VERSION, id: SessionId('broken'), createdAt: 1 }])
      }

      inspect(): Promise<never> {
        // A backend rejecting with a bare string is the non-Error path the report must still render.
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the string rejection is the case under test
        return Promise.reject('artifact unreadable')
      }
    }
    const ctx = new Context()
    await ctx.plugin(RejectingPersistence)
    await ctx.plugin(TrajectoryService)
    const sink = memorySink()
    const report = await ctx.trajectories.export({ sink })
    expect(report).toEqual({
      sessions: 1,
      exported: 0,
      rewarded: 0,
      filtered: 0,
      heldOut: 0,
      skipped: [{ sessionId: 'broken', reason: 'artifact unreadable' }],
    })
    expect(sink.closed).toBe(1)
  })

  it('writes lines to a file through jsonlFileSink', async () => {
    const { ctx, root } = await harness()
    await persist(ctx, 'certified', true)
    const path = join(root, 'out', '..', 'trajectories.jsonl')
    await ctx.trajectories.export({ sink: jsonlFileSink(path) })
    const lines = (await readFile(path, 'utf8')).trimEnd().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] as string)).toMatchObject({ format: 'dsh-trajectory/1', id: 'certified', reward: { outcome: 1 } })
  })

  it('registers its empty invariant companion', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(invariantCompanion)).resolves.toBeDefined()
  })
})
