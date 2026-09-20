import { get as httpGet } from 'node:http'
import type { Server } from 'node:http'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createHarnessFeedServer, foldSessionEvent, mapSessionToAgentId, sessionFilesForRun } from './harness-feed.ts'
import type { FeedEvent, LiveRoster, RunSummary, SafetyDetail } from './harness-feed.ts'
import type { Roster } from './enterprise-roster.ts'

const root = resolve(import.meta.dirname, '..')

// The real DeepSeek route and system-prompt phrasing a session stamps into its
// first `request/header`, copied from `examples/headless-agent/tests/snapshots/
// advanced-toolchain/session.jsonl` — a committed record of real event shapes,
// reused here rather than inventing a new one.
const REAL_ROUTE = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
const REAL_SYSTEM_PROMPT = 'You are headless-agent, a coding assistant powered by the deepseek-v4-flash model.'

/** One line of a synthesized `session.jsonl`, matching the real envelope `packages/core/session` writes. */
function line(type: string, seq: number, time: number, data: Record<string, unknown>): string {
  return `${JSON.stringify({ type, seq, time, data })}\n`
}

function toolCall(seq: number, time: number, callId: string, name: string, args: Record<string, unknown>): string {
  return line('tool/call', seq, time, { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) })
}

function toolResult(seq: number, time: number, callId: string, text: string, isError = false): string {
  return line('tool/result', seq, time, {
    turn: 1,
    step: 1,
    message: {
      source: { kind: 'tool', callId },
      content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text }], isError }],
      role: 'user',
      id: `result-${callId}`,
    },
  })
}

function sessionHeader(id: string): string {
  return `${JSON.stringify({ type: 'session', version: 0, id, createdAt: 1_800_000_000_000, delegationDepth: 0 })}\n`
}

function requestHeader(seq: number, time: number): string {
  return line('request/header', seq, time, { header: { config: REAL_ROUTE, system: REAL_SYSTEM_PROMPT } })
}

/** Builds `session-a/session.jsonl`: a turn with a plain tool call, a delegation, and a queued directive. */
function buildSessionA(): string {
  const t = 1_800_000_001_000
  return [
    sessionHeader('11111111-1111-4111-8111-111111111111'),
    line('turn/start', 1, t, { turn: 1 }),
    requestHeader(2, t + 1),
    line('step/start', 3, t + 2, { turn: 1, step: 1 }),
    toolCall(4, t + 3, 'call-1', 'bash', { command: 'echo hi' }),
    toolResult(5, t + 4, 'call-1', 'hi'),
    toolCall(6, t + 5, 'call-2', 'subagent', { description: 'child', prompt: 'do X' }),
    toolResult(7, t + 6, 'call-2', 'CHILD_OK'),
    line('agent/inbox/spliced', 8, t + 7, {
      target: 'next-turn',
      start: 0,
      inserted: [{ content: [{ type: 'text', text: 'follow up instruction' }], source: { kind: 'user' }, role: 'user', id: 'm-3' }],
    }),
    line('step/end', 9, t + 8, { turn: 1, step: 1 }),
    line('turn/end', 10, t + 9, { turn: 1, reason: { kind: 'completed' } }),
  ].join('')
}

/** Builds `session-b/session.jsonl`: a shorter second session on the same route. */
function buildSessionB(): string {
  const t = 1_800_000_002_000
  return [
    sessionHeader('22222222-2222-4222-8222-222222222222'),
    line('turn/start', 1, t, { turn: 1 }),
    requestHeader(2, t + 1),
    toolCall(3, t + 2, 'call-3', 'read', { path: 'README.md' }),
    toolResult(4, t + 3, 'call-3', 'file contents'),
    line('turn/end', 5, t + 4, { turn: 1, reason: { kind: 'completed' } }),
  ].join('')
}

interface Fixture {
  dir: string
  runDir: string
  sessionAFile: string
}

/**
 * `.proving-ground/runs/bench-e3/plan.json`: a real driver never writes an
 * explicit `kind` (it copies the user-authored plan file verbatim — see
 * `scripts/proving-ground.ts`'s own `planKind`), so this fixture declares
 * `baseline`/`candidate`, the real frozen-experiment marker, instead of the
 * fictional field the generator used to read.
 */
function makeFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-harness-feed-'))
  const runDir = join(dir, '.proving-ground/runs/bench-e3')
  mkdirSync(join(runDir, '.sessions/session-a'), { recursive: true })
  mkdirSync(join(runDir, '.sessions/session-b'), { recursive: true })
  writeFileSync(join(runDir, 'plan.json'), JSON.stringify({
    name: 'Bench E3',
    startedAt: '2026-09-19T00:00:00.000Z',
    baseline: { provider: 'claude-code', model: 'sonnet' },
    candidate: { provider: 'claude-code', model: 'sonnet' },
  }))
  writeFileSync(join(runDir, 'run.log'), '=== 2026-09-19T00:00:00.000Z plan=bench-e3 overlay=base head=abcdef012 ===\nbench-e3 started\n')
  const sessionAFile = join(runDir, '.sessions/session-a/session.jsonl')
  writeFileSync(sessionAFile, buildSessionA())
  writeFileSync(join(runDir, '.sessions/session-b/session.jsonl'), buildSessionB())
  return { dir, runDir, sessionAFile }
}

/** Collects folded SSE events from `/runs/:id/events` as they arrive. */
function collectSse(port: number, runId: string): {
  close: () => void
  waitForCount: (n: number, timeoutMs?: number) => Promise<FeedEvent[]>
} {
  const events: FeedEvent[] = []
  let buffer = ''
  const waiters: { n: number; resolve: (value: FeedEvent[]) => void }[] = []
  const req = httpGet(`http://127.0.0.1:${port}/runs/${runId}/events`, (res) => {
    res.setEncoding('utf8')
    res.on('data', (chunk: string) => {
      buffer += chunk
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const dataLine = frame.split('\n').find(candidate => candidate.startsWith('data: '))
        if (dataLine !== undefined) {
          events.push(JSON.parse(dataLine.slice('data: '.length)) as FeedEvent)
          for (const waiter of waiters.splice(0, waiters.length)) {
            if (events.length >= waiter.n) waiter.resolve(events.slice())
            else waiters.push(waiter)
          }
        }
        boundary = buffer.indexOf('\n\n')
      }
    })
  })
  const waitForCount = (n: number, timeoutMs = 4_000): Promise<FeedEvent[]> => new Promise((resolvePromise, reject) => {
    if (events.length >= n) {
      resolvePromise(events.slice())
      return
    }
    const timer = setTimeout(() => { reject(new Error(`timed out waiting for ${n} SSE events; got ${events.length}`)) }, timeoutMs)
    waiters.push({ n, resolve: (value) => { clearTimeout(timer); resolvePromise(value) } })
  })
  return { close: () => { req.destroy() }, waitForCount }
}

/** GET one path from a listening server as parsed JSON (uncast: each call site asserts its own expected shape). */
async function getJson(port: number, path: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`)
  return { status: response.status, body: await response.json() }
}

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** Starts the feed server on an ephemeral port over `fixturesDir`, registering it for teardown. */
/**
 * A temporary tree holding one fleet plan under `.proving-ground/runs/`, removed after the test.
 * @param prefix - The temporary directory's name prefix.
 * @returns The tree root and the run directory inside it.
 */
function makeFleetPlanDir(prefix: string): { dir: string; runDir: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanups.push(() => { rmSync(dir, { recursive: true, force: true }) })
  const runDir = join(dir, '.proving-ground/runs/h3-baseline-sonnet-t5-20260919T181623Z')
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(runDir, 'plan.json'), JSON.stringify({ name: 'h3-baseline-sonnet-t5', models: [{ provider: 'claude-code', model: 'sonnet' }] }))
  return { dir, runDir }
}

/**
 * The two-session fixture served by a fresh feed, with its `bench-e3` event stream open; everything is closed after the test.
 * @returns The fixture and the open stream.
 */
async function openFixtureStream(): Promise<{ fixture: Fixture; sse: ReturnType<typeof collectSse> }> {
  const fixture = makeFixture()
  cleanups.push(() => { rmSync(fixture.dir, { recursive: true, force: true }) })
  const { port } = await startServer(fixture.dir)
  const sse = collectSse(port, 'bench-e3')
  cleanups.push(sse.close)
  return { fixture, sse }
}

async function startServer(fixturesDir: string): Promise<{ server: Server; port: number }> {
  const server = createHarnessFeedServer({ root, fixturesDir })
  await new Promise<void>((resolvePromise) => { server.listen(0, '127.0.0.1', resolvePromise) })
  cleanups.push(() => { server.close() })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('harness-feed test: server did not bind a TCP port')
  return { server, port: address.port }
}

describe('GET /runs', () => {
  it('discovers a .proving-ground/runs fixture with its structurally inferred kind and a running status', async () => {
    const fixture = makeFixture()
    cleanups.push(() => { rmSync(fixture.dir, { recursive: true, force: true }) })
    const { port } = await startServer(fixture.dir)

    const { status, body: rawBody } = await getJson(port, '/runs')
    const body = rawBody as RunSummary[]
    expect(status).toBe(200)
    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({ id: 'bench-e3', kind: 'experiment', name: 'Bench E3', status: 'running' })
    expect(body[0]?.path).toBe('.proving-ground/runs/bench-e3')
  })

  it('classifies a plan.json with a models array as a fleet, not the experiment default', async () => {
    const { dir } = makeFleetPlanDir('dsh-harness-feed-fleet-')
    const { port } = await startServer(dir)

    const { body: rawBody } = await getJson(port, '/runs')
    const body = rawBody as RunSummary[]
    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({ kind: 'fleet', status: 'unknown' })
  })

  it('reports completed with the driver\'s own endedAt once run.log ends in a type: "result" line', async () => {
    const { dir, runDir } = makeFleetPlanDir('dsh-harness-feed-completed-')
    const banner = '=== 2026-09-19T18:16:23.466Z plan=h3-baseline-sonnet-t5 overlay=base head=8d5b54857 ==='
    const resultLine = JSON.stringify({ type: 'result', plan: 'h3-baseline-sonnet-t5', startedAt: '2026-09-19T18:16:25.923Z', endedAt: '2026-09-19T19:02:24.387Z', report: { group: 'fleet-x', cells: [] } })
    writeFileSync(join(runDir, 'run.log'), `${banner}\n${resultLine}\n`)
    const { port } = await startServer(dir)

    const { body: rawBody } = await getJson(port, '/runs')
    const body = rawBody as RunSummary[]
    expect(body[0]).toMatchObject({ kind: 'fleet', status: 'completed', endedAt: '2026-09-19T19:02:24.387Z' })
  })

  it('reports failed once run.log ends in a type: "error" or "refused" line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-harness-feed-failed-'))
    cleanups.push(() => { rmSync(dir, { recursive: true, force: true }) })
    for (const [runId, terminalType] of [['broken-run-error', 'error'], ['broken-run-refused', 'refused']] as const) {
      const runDir = join(dir, '.proving-ground/runs', runId)
      mkdirSync(runDir, { recursive: true })
      writeFileSync(join(runDir, 'plan.json'), JSON.stringify({ name: runId, baseline: {}, candidate: {} }))
      writeFileSync(join(runDir, 'run.log'), `${JSON.stringify({ type: terminalType, reason: 'policy denial' })}\n`)
    }
    const { port } = await startServer(dir)

    const { body: rawBody } = await getJson(port, '/runs')
    const body = rawBody as RunSummary[]
    expect(body.find(run => run.id === 'broken-run-error')).toMatchObject({ kind: 'experiment', status: 'failed' })
    expect(body.find(run => run.id === 'broken-run-refused')).toMatchObject({ kind: 'experiment', status: 'failed' })
    expect(body.every(run => run.endedAt === undefined)).toBe(true)
  })

  it('classifies a recorded run from result.json: report.goals is a program, result.arms is an experiment', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-harness-feed-recorded-kinds-'))
    cleanups.push(() => { rmSync(dir, { recursive: true, force: true }) })
    const programDir = join(dir, 'data/proving-ground/2026-09-19-csv-tools-program')
    mkdirSync(join(programDir, 'sessions'), { recursive: true })
    writeFileSync(join(programDir, 'sessions', 'program.jsonl'), sessionHeader('33333333-3333-4333-8333-333333333333'))
    writeFileSync(join(programDir, 'manifest.json'), JSON.stringify({ run: 'csv-tools-program', ranAt: '2026-09-19T10:55:12.975Z', endedAt: '2026-09-19T11:00:48.688Z' }))
    writeFileSync(join(programDir, 'result.json'), JSON.stringify({ type: 'result', report: { programId: 'program-x', goals: [{ key: 'stats', status: 'merged' }] } }))

    const experimentDir = join(dir, 'data/proving-ground/2026-09-19-bench-e3-attempts-t5')
    mkdirSync(join(experimentDir, 'sessions'), { recursive: true })
    writeFileSync(join(experimentDir, 'sessions', 'environment.jsonl'), sessionHeader('44444444-4444-4444-8444-444444444444'))
    writeFileSync(join(experimentDir, 'manifest.json'), JSON.stringify({ run: '2026-09-19-bench-e3-attempts-t5' }))
    writeFileSync(join(experimentDir, 'result.json'), JSON.stringify({ type: 'result', plan: 'e3-attempts-t5', result: { arms: { baseline: {}, candidate: {} } } }))

    const { port } = await startServer(dir)
    const { body: rawBody } = await getJson(port, '/runs')
    const body = rawBody as RunSummary[]
    expect(body.find(run => run.id === '2026-09-19-csv-tools-program')).toMatchObject({ kind: 'program', status: 'completed' })
    expect(body.find(run => run.id === '2026-09-19-bench-e3-attempts-t5')).toMatchObject({ kind: 'experiment', status: 'completed' })
  })
})

describe('GET /runs/:id/events', () => {
  it('replays both sessions in seq order, folding tool, delegation, directive, and step kinds', async () => {
    const { sse } = await openFixtureStream()
    const events = await sse.waitForCount(13)

    // session-a's 9 events precede session-b's 4 (sorted file order), each
    // internally ordered by its own seq; each file's `request/header` line
    // (seq 2) stamps the route/system prompt but folds to no event.
    const sessionAEvents = events.filter(e => e.sessionId === '11111111-1111-4111-8111-111111111111')
    const sessionBEvents = events.filter(e => e.sessionId === '22222222-2222-4222-8222-222222222222')
    expect(sessionAEvents.map(e => e.seq)).toEqual([1, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(sessionBEvents.map(e => e.seq)).toEqual([1, 3, 4, 5])
    expect(events.indexOf(sessionAEvents.at(-1)!)).toBeLessThan(events.indexOf(sessionBEvents[0]!))

    // tool/call and tool/result each fold into their own event (a call-started
    // and a call-finished moment), so "bash" and "subagent" each contribute two.
    expect(sessionAEvents.map(e => e.kind)).toEqual([
      'step', 'step', 'tool', 'tool', 'delegation', 'delegation', 'directive', 'step', 'step',
    ])
    const bashResult = sessionAEvents.find(e => e.kind === 'tool' && e.label === 'bash' && e.detail !== undefined)
    expect(bashResult?.detail).toBe('hi')
    const delegationEvents = sessionAEvents.filter(e => e.kind === 'delegation')
    expect(delegationEvents.every(e => e.label === 'subagent')).toBe(true)
    expect(delegationEvents.some(e => e.detail === 'CHILD_OK')).toBe(true)
    const directive = sessionAEvents.find(e => e.kind === 'directive')
    expect(directive?.detail).toBe('follow up instruction')
    expect(events.every(e => e.agentId.length > 0)).toBe(true)
  })

  it('tails an appended line within one poll interval', async () => {
    const { fixture, sse } = await openFixtureStream()
    await sse.waitForCount(13)

    appendFileSync(fixture.sessionAFile, line('step/start', 11, 1_800_000_002_000, { turn: 1, step: 2 }))
    const next = await sse.waitForCount(14)
    const appended = next.at(-1)
    expect(appended).toMatchObject({ seq: 11, kind: 'step', label: 'Step 2 started' })
  })

  it('answers 404 for an unknown run id', async () => {
    const fixture = makeFixture()
    cleanups.push(() => { rmSync(fixture.dir, { recursive: true, force: true }) })
    const { port } = await startServer(fixture.dir)
    const response = await fetch(`http://127.0.0.1:${port}/runs/does-not-exist/events`)
    expect(response.status).toBe(404)
  })
})

describe('GET /runs/:id/events for a recorded data/proving-ground run', () => {
  it('streams events from a two-file sessions/ layout built from real committed lines, well under one second', async () => {
    // Real lines copied out of two committed records (not re-typed by hand):
    // a slice of a real, event-rich session, and a real header-only one — see
    // the file-level comment for why `advanced-toolchain` is this suite's
    // chosen real-event source.
    const richLines = readFileSync(
      resolve(root, 'examples/headless-agent/tests/snapshots/advanced-toolchain/session.jsonl'),
      'utf8',
    ).split('\n').slice(0, 30).join('\n')
    const headerOnlyLine = readFileSync(
      resolve(root, 'examples/headless-agent/tests/snapshots/ralph-loop/session.jsonl'),
      'utf8',
    )

    const dir = mkdtempSync(join(tmpdir(), 'dsh-harness-feed-recorded-replay-'))
    cleanups.push(() => { rmSync(dir, { recursive: true, force: true }) })
    const runDir = join(dir, 'data/proving-ground/2026-09-19-recorded-replay-test')
    mkdirSync(join(runDir, 'sessions'), { recursive: true })
    writeFileSync(join(runDir, 'sessions', 'session-1.jsonl'), richLines)
    writeFileSync(join(runDir, 'sessions', 'session-2.jsonl'), headerOnlyLine)

    const { port } = await startServer(dir)
    const runsResponse = await getJson(port, '/runs')
    const runs = runsResponse.body as RunSummary[]
    expect(runs.find(run => run.id === '2026-09-19-recorded-replay-test')).toMatchObject({ status: 'completed' })

    const startedAt = Date.now()
    const sse = collectSse(port, '2026-09-19-recorded-replay-test')
    cleanups.push(sse.close)
    const events = await sse.waitForCount(5, 2_000)
    expect(Date.now() - startedAt).toBeLessThan(1_000)
    expect(events.length).toBeGreaterThanOrEqual(5)
    expect(events.every(event => event.agentId.length > 0)).toBe(true)
    // The real session's own event vocabulary (turn/step/request-header/etc.)
    // folds to a mix of recognized kinds, not one repeated placeholder.
    expect(new Set(events.map(event => event.kind)).size).toBeGreaterThan(1)
  })
})

describe('the fold and mapping functions directly', () => {
  it('folds the real certificate and merge types, the aspirational finding prefix, and a refusal', () => {
    const state = { sessionId: 's1', callNameById: new Map<string, string>() }
    expect(foldSessionEvent({ type: 'verification/certificate', seq: 1, time: 1, data: { verifier: 'oxlint' } }, state)?.kind)
      .toBe('certificate')
    expect(foldSessionEvent({ type: 'program/integration', seq: 2, time: 1, data: { department: 'secrets' } }, state))
      .toMatchObject({ kind: 'merge', label: 'secrets' })
    expect(foldSessionEvent({ type: 'finding/rule-x', seq: 3, time: 1, data: { message: 'hardcoded key', severity: 'high' } }, state))
      .toMatchObject({ kind: 'finding', label: 'hardcoded key', severity: 'high' })
    state.callNameById.set('call-9', 'edit')
    const refusal = foldSessionEvent({
      type: 'tool/result',
      seq: 4,
      time: 1,
      data: { message: { source: { callId: 'call-9' }, content: [{ isError: true, content: [{ text: 'Denied: file must be read first' }] }] } },
    }, state)
    expect(refusal).toMatchObject({ kind: 'refusal', label: 'edit' })
  })

  it('drops a request/header line: it stamps the session but is not itself a reported event', () => {
    const state = { sessionId: 's1', callNameById: new Map<string, string>() }
    expect(foldSessionEvent({ type: 'request/header', seq: 1, time: 1, data: { header: {} } }, state)).toBeUndefined()
  })

  it('skips a line whose type is missing, or not a string, instead of throwing', () => {
    const state = { sessionId: 's1', callNameById: new Map<string, string>() }
    // A session file's own header line, and `facts.jsonl`/`trajectories.jsonl`
    // rows a layout this module does not recognize might still surface, both
    // carry no `type` at all.
    expect(foldSessionEvent({ version: 0, id: 's1', createdAt: 1, delegationDepth: 0 }, state)).toBeUndefined()
    expect(foldSessionEvent({ identity: { environment: 'code:x' }, outcome: 'pass' }, state)).toBeUndefined()
    // A `type` present but not a string must not reach `.startsWith` either.
    expect(foldSessionEvent({ type: 42, seq: 1, time: 1 }, state)).toBeUndefined()
  })

  it('maps a session to the first agent sharing its stamped provider and model', () => {
    const roster: Roster = {
      generatedAt: '2026-01-01T00:00:00Z',
      counts: { defined: 2, active: 0 },
      divisions: [],
      agents: [
        {
          id: 'a', name: 'A', role: 'steward', division: 'harness-core', route: REAL_ROUTE, preset: 'coding',
          skills: [], tools: [], source: 'package.json', status: 'defined',
        },
        {
          id: 'b', name: 'B', role: 'verifier', division: 'verification', route: { provider: 'codex', model: 'codex' },
          preset: 'reviewing', skills: [], tools: [], source: 'package.json', status: 'defined',
        },
      ],
      edges: [],
    }
    const lines = [{ type: 'request/header', data: { header: { config: REAL_ROUTE, system: REAL_SYSTEM_PROMPT } } }]
    expect(mapSessionToAgentId(lines, roster, 'fallback')).toBe('a')
    expect(mapSessionToAgentId([], roster, 'fallback')).toBe('fallback')
  })

  it('maps a program session to the code-safety seat its id names, ahead of any route match', () => {
    const roster = JSON.parse(readFileSync(resolve(root, 'data/enterprise/roster.json'), 'utf8')) as Roster
    const digest = 'a'.repeat(64)
    const session = (id: string) => [{ type: 'session', id }, { type: 'request/header', data: { header: { config: REAL_ROUTE, system: REAL_SYSTEM_PROMPT } } }]
    expect(mapSessionToAgentId(session(`program-${digest}-secrets`), roster, 'fallback')).toBe('code-safety-secrets-integrator')
    expect(mapSessionToAgentId(session(`program-${digest}-~0040integration`), roster, 'fallback')).toBe('code-safety-lead')
    expect(mapSessionToAgentId(session(`program-${digest}`), roster, 'fallback')).toBe('code-safety-lead')
    // The id may also be handed in by a caller that has it without the session line.
    expect(mapSessionToAgentId([], roster, 'fallback', `program-${digest}-injection`)).toBe('code-safety-injection-integrator')
    // A department the roster does not seat falls through to the route match.
    expect(mapSessionToAgentId(session(`program-${digest}-unknown`), roster, 'fallback')).not.toMatch(/^code-safety-/)
  })
})

describe('GET /roster', () => {
  it('reports the fixture session as active and counts it', async () => {
    const fixture = makeFixture()
    cleanups.push(() => { rmSync(fixture.dir, { recursive: true, force: true }) })
    const { port } = await startServer(fixture.dir)

    const { status, body: rawBody } = await getJson(port, '/roster')
    const body = rawBody as LiveRoster
    expect(status).toBe(200)
    expect(body.counts.defined).toBe(147)
    expect(body.counts.active).toBe(1)
    const active = body.agents.filter(agent => agent.status === 'active')
    expect(active).toHaveLength(1)
    expect(active[0]?.route).toEqual(REAL_ROUTE)
  })

  it('re-reads a session file that grew since the last request, so a new certificate shows on the next roster', async () => {
    const fixture = makeFixture()
    cleanups.push(() => { rmSync(fixture.dir, { recursive: true, force: true }) })
    const { port } = await startServer(fixture.dir)

    // Session B shares session A's agent and would keep it active; only A is under test here.
    rmSync(join(fixture.runDir, '.sessions/session-b'), { recursive: true, force: true })
    const first = (await getJson(port, '/roster')).body as LiveRoster
    expect(first.counts.active).toBe(1)
    appendFileSync(fixture.sessionAFile, line('verification/certificate', 99, 99, { verifier: 'oxlint' }))
    const second = (await getJson(port, '/roster')).body as LiveRoster
    expect(second.counts.active).toBe(0)
    expect(second.agents.filter(agent => agent.status === 'certified')).toHaveLength(1)
  })

  it('reports zero active agents with no discoverable runs', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'dsh-harness-feed-empty-'))
    cleanups.push(() => { rmSync(empty, { recursive: true, force: true }) })
    const { port } = await startServer(empty)

    const { body: rawBody } = await getJson(port, '/roster')
    const body = rawBody as LiveRoster
    expect(body.counts).toEqual({ defined: 147, active: 0 })
    expect(body.agents.every(agent => agent.status === 'defined')).toBe(true)
  })
})

describe('POST /safety', () => {
  it('answers 501, naming code-safety, when the root package.json has no code-safety script', async () => {
    // `hasCodeSafetyScript` checks the server's own `root`, not the discovery
    // `fixturesDir` — a fake root with no such script exercises the 501
    // branch even now that this repository's own package.json defines one.
    const fakeRoot = mkdtempSync(join(tmpdir(), 'dsh-harness-feed-no-script-'))
    cleanups.push(() => { rmSync(fakeRoot, { recursive: true, force: true }) })
    writeFileSync(join(fakeRoot, 'package.json'), JSON.stringify({ name: 'fake', scripts: {} }))
    const server = createHarnessFeedServer({ root: fakeRoot })
    await new Promise<void>((resolvePromise) => { server.listen(0, '127.0.0.1', resolvePromise) })
    cleanups.push(() => { server.close() })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('harness-feed test: server did not bind a TCP port')

    const response = await fetch(`http://127.0.0.1:${address.port}/safety`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: '/tmp/some-target' }),
    })
    expect(response.status).toBe(501)
    const body = await response.json() as { error: string }
    expect(body.error).toMatch(/code-safety/)
  })

  it('answers 202 with a run id once the root package.json defines pnpm run code-safety', async () => {
    // This repository's own package.json defines the script (scripts/code-safety.ts,
    // merged from the parallel workstream), so the real server root exercises
    // the spawn branch; a nonexistent target makes the detached child exit
    // immediately without touching anything on disk.
    const empty = mkdtempSync(join(tmpdir(), 'dsh-harness-feed-safety-'))
    cleanups.push(() => { rmSync(empty, { recursive: true, force: true }) })
    const { port } = await startServer(empty)

    const response = await fetch(`http://127.0.0.1:${port}/safety`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: '/tmp/dsh-harness-feed-spec-nonexistent-target' }),
    })
    expect(response.status).toBe(202)
    const body = await response.json() as { id: string }
    // The id is the run directory's name under `.code-safety/`: the target's
    // basename and a second-resolution stamp, so the deck can follow the run
    // under the id it was handed.
    expect(body.id).toMatch(/^dsh-harness-feed-spec-nonexistent-target-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/)
  })
})

describe('code-safety runs', () => {
  it('serves a recorded data/code-safety run: id-prefix department attribution and severity counts tallied from findings', async () => {
    // Shapes copied from the real merged data/code-safety/2026-09-19-nodegoat
    // record: a finding carries no `department` field, only an id prefixed
    // with one; manifest.json is the source of ranAt/endedAt/target.root.
    const dir = mkdtempSync(join(tmpdir(), 'dsh-harness-feed-recorded-safety-'))
    cleanups.push(() => { rmSync(dir, { recursive: true, force: true }) })
    const runDir = join(dir, 'data/code-safety/2026-09-19-fixture-target')
    mkdirSync(join(runDir, 'sessions'), { recursive: true })
    writeFileSync(join(runDir, 'sessions', 'program.jsonl'), sessionHeader('55555555-5555-4555-8555-555555555555'))
    writeFileSync(join(runDir, 'manifest.json'), JSON.stringify({
      run: '2026-09-19-fixture-target',
      ranAt: '2026-09-19T10:00:00.000Z',
      endedAt: '2026-09-19T11:00:00.000Z',
      target: { root: runDir },
    }))
    writeFileSync(join(runDir, 'findings.json'), JSON.stringify([
      { id: 'secrets-hardcoded-key', severity: 'critical', file: 'src/config.js', line: 3, title: 'Hardcoded key' },
      { id: 'access-idor-allocations', severity: 'high', file: 'app/routes/index.js', line: 63, title: 'IDOR' },
    ]))
    writeFileSync(join(runDir, 'SAFETY-REPORT.md'), '# Fixture target safety report\n')
    writeFileSync(join(runDir, 'verifier.txt'), 'exit 0\nok: verified against fixture target\n')
    const { port } = await startServer(dir)

    const runsResponse = await getJson(port, '/runs')
    const runs = runsResponse.body as RunSummary[]
    expect(runs.find(run => run.id === '2026-09-19-fixture-target')).toMatchObject({
      kind: 'code-safety', status: 'completed', endedAt: '2026-09-19T11:00:00.000Z',
    })

    const { status, body: rawBody } = await getJson(port, '/safety/2026-09-19-fixture-target')
    expect(status).toBe(200)
    const detail = rawBody as SafetyDetail
    expect(detail.findings).toHaveLength(2)
    expect(detail.certificate).toMatchObject({
      verified: true,
      output: 'ok: verified against fixture target\n',
      counts: { critical: 1, high: 1, medium: 0, low: 0, info: 0 },
    })
    const secrets = detail.departments.find(department => department.id === 'secrets')
    const access = detail.departments.find(department => department.id === 'access')
    expect(secrets).toMatchObject({ findings: 1, status: 'findings', certified: true })
    expect(access).toMatchObject({ findings: 1, status: 'findings', certified: true })
    expect(detail.departments.filter(department => department.findings === 0).every(department => department.status === 'clean')).toBe(true)
    expect(detail.report.markdown).toBe('# Fixture target safety report\n')
  })

  it('answers 404 for an unknown code-safety id, and reports a live run with no result line yet as running with pending departments', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-harness-feed-live-safety-'))
    cleanups.push(() => { rmSync(dir, { recursive: true, force: true }) })
    const runDir = join(dir, '.code-safety', 'fixture-run1')
    mkdirSync(join(runDir, 'repo'), { recursive: true })
    writeFileSync(join(runDir, 'repo', 'target.json'), JSON.stringify({ root: runDir }))
    writeFileSync(join(runDir, 'stdout.jsonl'), '')
    const { port } = await startServer(dir)

    const missing = await fetch(`http://127.0.0.1:${port}/safety/does-not-exist`)
    expect(missing.status).toBe(404)

    const runsResponse = await getJson(port, '/runs')
    const runs = runsResponse.body as RunSummary[]
    expect(runs.find(run => run.id === 'fixture-run1')).toMatchObject({ kind: 'code-safety', status: 'running' })
    expect(runs.find(run => run.id === 'fixture-run1')?.endedAt).toBeUndefined()

    const { status, body: rawBody } = await getJson(port, '/safety/fixture-run1')
    expect(status).toBe(200)
    const detail = rawBody as SafetyDetail
    expect(detail.findings).toEqual([])
    expect(detail.departments.every(department => department.status === 'pending' && !department.certified)).toBe(true)
  })
})

describe('CORS and malformed input', () => {
  it('sets Access-Control-Allow-Origin on every response, including an error', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'dsh-harness-feed-cors-'))
    cleanups.push(() => { rmSync(empty, { recursive: true, force: true }) })
    const { port } = await startServer(empty)

    const response = await fetch(`http://127.0.0.1:${port}/does-not-exist`)
    expect(response.status).toBe(404)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('never crashes on a torn or malformed session.jsonl line', async () => {
    const fixture = makeFixture()
    cleanups.push(() => { rmSync(fixture.dir, { recursive: true, force: true }) })
    appendFileSync(fixture.sessionAFile, '{"type":"tool/call","seq":11,"time":1,"data":{not json\n')
    const { port } = await startServer(fixture.dir)

    const { status, body: rawBody } = await getJson(port, '/runs')
    const body = rawBody as RunSummary[]
    expect(status).toBe(200)
    expect(body).toHaveLength(1)
  })

  it('never crashes on a stray non-session *.jsonl file next to a recorded run\'s sessions/ directory', async () => {
    // `facts.jsonl`/`trajectories.jsonl` sit beside `sessions/` in a real
    // `data/proving-ground/<id>` directory and carry no `type` field at all;
    // this reproduces the original crash directly rather than only through
    // the scoped-discovery fix in sessionFilesForRun.
    const dir = mkdtempSync(join(tmpdir(), 'dsh-harness-feed-stray-jsonl-'))
    cleanups.push(() => { rmSync(dir, { recursive: true, force: true }) })
    const runDir = join(dir, 'data/proving-ground/stray-jsonl-run')
    mkdirSync(join(runDir, 'sessions'), { recursive: true })
    writeFileSync(join(runDir, 'sessions', 'environment.jsonl'), buildSessionA())
    writeFileSync(join(runDir, 'facts.jsonl'), `${JSON.stringify({ identity: { environment: 'code:x' }, outcome: 'pass' })}\n`)
    writeFileSync(join(runDir, 'trajectories.jsonl'), `${JSON.stringify({ turns: [] })}\n`)
    const { port } = await startServer(dir)

    const rosterResponse = await getJson(port, '/roster')
    expect(rosterResponse.status).toBe(200)
    const runsResponse = await getJson(port, '/runs')
    expect(runsResponse.status).toBe(200)
    const runs = runsResponse.body as RunSummary[]
    const run = runs.find(candidate => candidate.id === 'stray-jsonl-run')
    expect(run).toBeDefined()
    // Scoped to sessions/, so the stray files are never even opened.
    expect(sessionFilesForRun(dir, run!)).toEqual([join(runDir, 'sessions', 'environment.jsonl')])
  })
})
