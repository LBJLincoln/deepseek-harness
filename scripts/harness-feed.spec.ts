import { get as httpGet } from 'node:http'
import type { Server } from 'node:http'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createHarnessFeedServer, foldSessionEvent, mapSessionToAgentId } from './harness-feed.ts'
import type { FeedEvent, LiveRoster, RunSummary } from './harness-feed.ts'
import type { Roster } from './enterprise-roster.ts'

const root = resolve(import.meta.dirname, '..')

// The real DeepSeek route and system-prompt phrasing a session stamps into its
// first `request/header`, copied from `examples/headless-agent/tests/snapshots/
// advanced-toolchain/session.jsonl` — a committed record of real event shapes.
// This tree has no `data/proving-ground/` recording (see the Agent Note this
// change adds), so the fixtures below reuse that headless-agent record's exact
// event shapes rather than inventing a new one.
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

function makeFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-harness-feed-'))
  const runDir = join(dir, '.proving-ground/runs/bench-e3')
  mkdirSync(join(runDir, '.sessions/session-a'), { recursive: true })
  mkdirSync(join(runDir, '.sessions/session-b'), { recursive: true })
  writeFileSync(join(runDir, 'plan.json'), JSON.stringify({ kind: 'experiment', name: 'Bench E3', startedAt: '2026-09-19T00:00:00.000Z' }))
  writeFileSync(join(runDir, 'run.log'), 'bench-e3 started\n')
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
async function startServer(fixturesDir: string): Promise<{ server: Server; port: number }> {
  const server = createHarnessFeedServer({ root, fixturesDir })
  await new Promise<void>((resolvePromise) => { server.listen(0, '127.0.0.1', resolvePromise) })
  cleanups.push(() => { server.close() })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('harness-feed test: server did not bind a TCP port')
  return { server, port: address.port }
}

describe('GET /runs', () => {
  it('discovers a .proving-ground/runs fixture with its plan-declared kind and a running status', async () => {
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
})

describe('GET /runs/:id/events', () => {
  it('replays both sessions in seq order, folding tool, delegation, directive, and step kinds', async () => {
    const fixture = makeFixture()
    cleanups.push(() => { rmSync(fixture.dir, { recursive: true, force: true }) })
    const { port } = await startServer(fixture.dir)

    const sse = collectSse(port, 'bench-e3')
    cleanups.push(sse.close)
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
    const fixture = makeFixture()
    cleanups.push(() => { rmSync(fixture.dir, { recursive: true, force: true }) })
    const { port } = await startServer(fixture.dir)

    const sse = collectSse(port, 'bench-e3')
    cleanups.push(sse.close)
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

describe('the fold and mapping functions directly', () => {
  it('folds the aspirational certificate, merge, finding, and refusal prefixes', () => {
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
  it('answers 501 while pnpm run code-safety is not yet defined', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'dsh-harness-feed-safety-'))
    cleanups.push(() => { rmSync(empty, { recursive: true, force: true }) })
    const { port } = await startServer(empty)

    const response = await fetch(`http://127.0.0.1:${port}/safety`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: '/tmp/some-target' }),
    })
    expect(response.status).toBe(501)
    const body = await response.json() as { error: string }
    expect(body.error).toMatch(/code-safety/)
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
})
