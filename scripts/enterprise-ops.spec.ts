import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { OpsAttention } from '../apps/command-deck/deck/contract.ts'
import {
  collectOps, emptyOpsState, loadOpsState, OPS_STATE_FORMAT, parseOpsArgs, rankAttention, sessionRole, type OpsInputs, type OpsState,
} from './enterprise-ops.ts'
import {
  claudeProjectName,
  currentCycleStep,
  cyclesFromHistory,
  describeToolCall,
  emptyTranscript,
  foldHarnessSession,
  foldProgramLedger,
  foldTranscript,
  newestCapture,
  parseCaptureLog,
  parseCiJobs,
  parseCiRuns,
  parseCycleLog,
  parseJsonl,
  parseMeminfo,
  parseSchedulerLog,
  pendingCycleSteps,
  publicLine,
  reviewVerdictOf,
  type ProcessInfo,
} from './enterprise-ops-sources.ts'

const NOW = new Date('2026-09-28T22:40:00.000Z')
const SHIPPED = '1d6a5d3430aef9893b1a28adfea1f1841238c866'
const TIP = '52c56001db9a56d046f0fe8f4efdb3859ddd2ae7'
const PROGRAM = `program-${'a'.repeat(64)}`

function at(iso: string): number {
  return Date.parse(iso)
}

function jsonl(rows: readonly unknown[]): string {
  return `${rows.map(row => JSON.stringify(row)).join('\n')}\n`
}

describe('publicLine', () => {
  it('removes credential-shaped strings, cuts home and temporary paths, and keeps one short line', () => {
    const line = publicLine('curl -H "Authorization: Bearer abc.def" GITHUB_TOKEN=ghp_1234567890abcdef sk-live-abcdefghij /home/user/deepseek-harness/scripts/x.ts\n\n done')
    expect(line).not.toContain('abc.def')
    expect(line).not.toContain('ghp_1234567890abcdef')
    expect(line).not.toContain('sk-live')
    expect(line).toContain('GITHUB_TOKEN=…')
    expect(line).toContain('x.ts done')
    expect(line).not.toContain('/home/user')
    expect(publicLine('x'.repeat(10) + ' ' + 'word '.repeat(40), 30)).toHaveLength(30)
    expect(publicLine(`hash ${'f'.repeat(64)}`)).toBe('hash …')
  })

  it('masks every e-mail address and the shared transcript redaction\'s credential shapes', () => {
    const line = publicLine('mail operator.name+ops@example.co.uk about sk-ant-api03-abcdefghijklmnopqrstuvwxyz and AKIAABCDEFGHIJKLMNOP')
    expect(line).toBe('mail [REDACTED-EMAIL] about [REDACTED-ANTHROPIC-KEY] and [REDACTED-AWS-ACCESS-KEY]')
    expect(publicLine('Commit as noreply@anthropic.com')).not.toContain('@')
  })

  it('names a tool call by its description, else by the last segment of its target', () => {
    expect(describeToolCall('Bash', { command: 'rm -rf x', description: 'Run the tests' })).toBe('Bash: Run the tests')
    expect(describeToolCall('Edit', { file_path: '/home/user/repo/apps/deck/README.md' })).toBe('Edit README.md')
    expect(describeToolCall('Grep', undefined)).toBe('Grep')
  })

  it('names a working directory the way Claude Code names its transcript directory', () => {
    expect(claudeProjectName('/tmp/dsh-enterprise/221520-e979/repo/program-ab/@integration')).toBe('-tmp-dsh-enterprise-221520-e979-repo-program-ab--integration')
  })
})

describe('cycle logs', () => {
  const log = [
    'noise before the first step',
    'enterprise-cycle: cycle-20260928T235901Z pull exit=0 at 23:59:10Z',
    'enterprise-cycle: cycle-20260928T235901Z intake exit=3 at 00:02:00Z',
    'enterprise: shift 000210-ab12 → /tmp/dsh-enterprise/000210-ab12',
    'enterprise-cycle: cycle-20260928T235901Z intake-push exit=0 at 00:02:05Z',
  ].join('\n')

  it('dates each step from the log\'s stamp and rolls past midnight', () => {
    const parsed = parseCycleLog('cycle-20260928T235900Z.log', log)
    expect(parsed?.cycle).toBe('cycle-20260928T235901Z')
    expect(parsed?.steps.map(step => [step.step, step.exit, step.at])).toEqual([
      ['pull', 0, '2026-09-28T23:59:10.000Z'],
      ['intake', 3, '2026-09-29T00:02:00.000Z'],
      ['intake-push', 0, '2026-09-29T00:02:05.000Z'],
    ])
    expect(parsed?.shift).toBe('000210-ab12')
    expect(parsed?.done).toBeUndefined()
  })

  it('reads a step line stamped with a full ISO instant as the cycle writes it', () => {
    const parsed = parseCycleLog('cycle-20260928T231300Z.log', 'enterprise-cycle: cycle-20260928T231301Z publish exit=0 at 2026-09-29T00:40:02Z')
    expect(parsed?.steps).toEqual([{ step: 'publish', exit: 0, at: '2026-09-29T00:40:02.000Z' }])
    expect(parsed === undefined ? undefined : currentCycleStep(parsed)).toBe('record')
  })

  it('names the running step, skipping the shift after an intake the usage limit stopped', () => {
    const parsed = parseCycleLog('cycle-20260928T235900Z.log', log)
    expect(parsed === undefined ? undefined : currentCycleStep(parsed)).toBe('pull-after-shift')
    const fresh = parseCycleLog('cycle-20260928T235900Z.log', '')
    expect(fresh === undefined ? undefined : currentCycleStep(fresh)).toBe('pull')
    const unknown = parseCycleLog('cycle-20260928T235900Z.log', 'enterprise-cycle: cycle-20260928T235901Z finish exit=0 at 23:59:30Z')
    expect(unknown === undefined ? undefined : currentCycleStep(unknown)).toBe('after finish')
  })

  it('reads the closing line and a refusal, and refuses a file name without a stamp', () => {
    const done = parseCycleLog('cycle-20260928T221300Z.log', 'enterprise-cycle: cycle-20260928T221301Z done, first failure exit=1')
    expect(done?.done).toEqual({ firstFailure: 1 })
    expect(parseCycleLog('cycle-20260928T221300Z.log', 'enterprise-cycle: another cycle holds the lock')?.refused).toBe('another cycle holds the lock')
    expect(parseCycleLog('scheduler.log', 'anything')).toBeUndefined()
  })

  it('reads the scheduler\'s newest announced slot and each cycle\'s exit code', () => {
    const log = parseSchedulerLog([
      'enterprise-scheduler: next cycle at 2026-09-28T22:13:00Z',
      'enterprise-scheduler: cycle-20260928T221300Z exit=2 at 00:11:04Z',
      'enterprise-scheduler: next cycle at 2026-09-29T00:13:00Z',
      'enterprise-scheduler: cycle-20260929T001300Z exit=5 at 00:13:01Z',
    ].join('\n'))
    expect(log.nextAt).toBe('2026-09-29T00:13:00.000Z')
    expect([...log.exits]).toEqual([['cycle-20260928T221300Z', 2], ['cycle-20260929T001300Z', 5]])
    expect(parseSchedulerLog('').nextAt).toBeUndefined()
  })

  it('lists the steps a running cycle has still to reach, and none after a step the order does not know', () => {
    const running = parseCycleLog('cycle-20260928T235900Z.log', 'enterprise-cycle: cycle-20260928T235901Z roster exit=0 at 23:59:10Z')
    expect(running === undefined ? undefined : pendingCycleSteps(running)).toEqual(['record', 'push'])
    const unknown = parseCycleLog('cycle-20260928T235900Z.log', 'enterprise-cycle: cycle-20260928T235901Z finish exit=0 at 23:59:30Z')
    expect(unknown === undefined ? undefined : pendingCycleSteps(unknown)).toEqual([])
  })

  it('reads the transcript capture\'s newest push and a newer round that did not push', () => {
    const log = parseCaptureLog([
      'capture-live: captured 10 chunks',
      'transcripts-capture: 2026-09-28T23:59:56Z pushed 2c8c029e0 at 00:00:03Z',
      'transcripts-capture: 2026-09-29T00:04:56Z pushed 148490ce5 at 00:05:03Z',
      'transcripts-capture: 2026-09-29T00:09:56Z push failed after 5 tries; the next round pushes it',
      'transcripts-capture: another capture loop holds the lock',
    ].join('\n'))
    expect(log.push).toEqual({ at: at('2026-09-29T00:05:03Z'), commit: '148490ce5' })
    expect(log.problem).toEqual({ at: at('2026-09-29T00:09:56Z'), line: 'push failed after 5 tries; the next round pushes it' })
    // A push that crossed midnight is dated on the next day.
    expect(parseCaptureLog('transcripts-capture: 2026-09-28T23:59:56Z pushed 2c8c029e0 at 00:00:03Z').push?.at).toBe(at('2026-09-29T00:00:03Z'))
    expect(parseCaptureLog('')).toEqual({})
  })

  it('finds each cycle in the branch history with its span and newest commit', () => {
    const history = [
      `${TIP}\t2026-09-28T22:40:00Z\tchore(enterprise): cycle-20260928T221301Z functions, roster and deck`,
      `${SHIPPED}\t2026-09-28T22:15:19Z\tchore(enterprise): cycle-20260928T221301Z intake`,
      `${SHIPPED}\t2026-09-28T21:00:00Z\tfeat(enterprise): something else`,
      'not a line',
    ].join('\n')
    expect([...cyclesFromHistory(history)]).toEqual([
      ['cycle-20260928T221301Z', { first: '2026-09-28T22:15:19.000Z', last: '2026-09-28T22:40:00.000Z', commit: TIP }],
    ])
  })

  it('finds the transcript capture\'s newest round in the branch history', () => {
    const history = [
      `${TIP}\t2026-09-28T22:38:40Z\tchore(transcripts): live capture 2026-09-28T22:38:02Z`,
      `${TIP}\t2026-09-28T22:44:00Z\tchore(transcripts): live capture unstamped`,
      `${SHIPPED}\t2026-09-28T22:33:02Z\tchore(transcripts): live capture 2026-09-28T22:33:02Z`,
    ].join('\n')
    expect(newestCapture(history)).toBe(at('2026-09-28T22:44:00Z'))
    expect(newestCapture(`${TIP}\t2026-09-28T22:38:40Z\tchore(enterprise): cycle-20260928T221301Z intake`)).toBeUndefined()
  })
})

describe('harness session logs', () => {
  it('folds the newest tool call, the tokens, the certificate and the goal\'s end', () => {
    const facts = foldHarnessSession(parseJsonl(jsonl([
      { type: 'session', id: `${PROGRAM}-t-0001`, createdAt: 1000 },
      { type: 'turn/start', seq: 0, time: 1100, data: {} },
      { type: 'tool/call', seq: 1, time: 1200, data: { name: 'bash', arguments: JSON.stringify({ command: 'pnpm test', description: 'Run the package tests' }) } },
      { type: 'assistant/chunk', seq: 2, time: 1300, data: { chunk: { type: 'usage', usage: { inputTokens: 2, outputTokens: 10, cacheReadTokens: 100, cacheWriteTokens: 5 } } } },
      { type: 'verification/certificate', seq: 3, time: 1400, data: {} },
      { type: 'goal/change', seq: 4, time: 1500, data: { operation: 'complete' } },
    ]) + '{"torn'), 'fallback')
    expect(facts.sessionId).toBe(`${PROGRAM}-t-0001`)
    expect(facts.createdAt).toBe(1000)
    expect(facts.lastAt).toBe(1500)
    expect(facts.tokens).toBe(117)
    expect(facts.certified).toBe(true)
    expect(facts.goalEnded).toBe(true)
    expect(facts.doing).toBe('goal completed')
    expect(facts.frames.map(frame => [frame.seq, frame.kind, frame.label])).toEqual([
      [1, 'step', 'starting a turn'],
      [2, 'tool', 'bash: Run the package tests'],
      [4, 'certificate', 'certified'],
      [5, 'merge', 'goal completed'],
    ])
  })

  it('reports a session that is still working as neither certified nor ended', () => {
    const facts = foldHarnessSession(parseJsonl(jsonl([
      { type: 'session', id: 'review-t-0019-da50c0af', createdAt: 10 },
      { type: 'turn/end', seq: 0, time: 20, data: {} },
    ])), 'fallback')
    expect(facts).toMatchObject({ certified: false, goalEnded: false, turnEnded: true, tokens: 0 })
  })

  it('folds a shift\'s program ledger into each goal\'s newest status, title and reason', () => {
    const ledger = foldProgramLedger(parseJsonl(jsonl([
      { type: 'session', id: PROGRAM, createdAt: 1 },
      { type: 'program/start', seq: 0, time: 10, data: { spec: { goals: [{ key: 't-0014', objective: 'Ticket T-0014: Pin the refusal.\nYou are the Subagent Steward.' }, { key: 't-0016', objective: 'no title line' }, { objective: 'keyless' }] } } },
      { type: 'program/goal', seq: 1, time: 11, data: { key: 't-0014', status: 'running' } },
      { type: 'program/goal', seq: 2, time: 20, data: { key: 't-0014', status: 'blocked', reason: 'budget-exhausted' } },
      { type: 'program/goal', seq: 3, time: 21, data: { key: 't-0016', status: 'running' } },
      { type: 'program/goal', seq: 4, time: 22, data: { status: 'running' } },
      { type: 'program/end', seq: 5, time: 30, data: { outcome: 'failed' } },
    ])))
    expect(ledger).toEqual({
      startedAt: 10,
      endedAt: 30,
      goals: [
        { key: 't-0014', title: 'Pin the refusal.', status: 'blocked', since: 20, reason: 'budget-exhausted' },
        { key: 't-0016', status: 'running', since: 21 },
      ],
    })
  })

  it('reads a review\'s verdict from its newest answer, and none before it answers', () => {
    const answer = (text: string): Record<string, unknown> => ({ type: 'assistant/message', seq: 1, time: 5, data: { message: { role: 'assistant', content: [{ type: 'text', text }] } } })
    expect(reviewVerdictOf(parseJsonl(jsonl([{ type: 'session', id: 'review-t-0016-aa' }, answer('verdict: approve\n\n- scope ok')])))).toBe('approve')
    expect(reviewVerdictOf(parseJsonl(jsonl([answer('verdict: approve'), answer('Verdict: REJECT — out of scope')])))).toBe('reject')
    expect(reviewVerdictOf(parseJsonl(jsonl([answer('thinking about it'), { type: 'turn/start', seq: 2, time: 6, data: {} }])))).toBeUndefined()
  })

  it('names each program session by its role', () => {
    const tickets = new Map([['T-0001', { id: 'T-0001', seat: 'harness-core-agent-steward', division: 'harness-core' }]])
    expect(sessionRole(`${PROGRAM}-t-0001`, undefined, tickets)).toEqual({ kind: 'department', label: 'T-0001', ticket: 'T-0001', seat: 'harness-core-agent-steward', division: 'harness-core' })
    expect(sessionRole('review-t-0019-da50c0af', undefined, undefined)).toEqual({ kind: 'reviewer', label: 'review of T-0019', ticket: 'T-0019' })
    expect(sessionRole(`${PROGRAM}-~0040integration`, undefined, undefined)?.label).toBe('integration')
    expect(sessionRole(PROGRAM, undefined, undefined)).toBeUndefined()
  })
})

describe('Claude Code transcripts', () => {
  const lines = [
    { type: 'user', timestamp: '2026-09-28T22:00:00.000Z', message: { role: 'user', content: 'brief' } },
    { type: 'assistant', timestamp: '2026-09-28T22:01:00.000Z', message: { id: 'm1', stop_reason: null, usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 30, cache_creation_input_tokens: 4 }, content: [{ type: 'tool_use', name: 'Bash', input: { description: 'List files' } }] } },
    { type: 'assistant', timestamp: '2026-09-28T22:01:01.000Z', message: { id: 'm1', stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 30, cache_creation_input_tokens: 4 }, content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/tmp/a/b.ts' } }] } },
    { type: 'assistant', timestamp: '2026-09-28T22:02:00.000Z', message: { id: 'm2', stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 }, content: [{ type: 'text', text: 'done' }] } },
  ].map(row => JSON.stringify(row))

  it('reads incrementally, counts a message once across reads, and numbers frames by line', () => {
    const whole = `${lines.join('\n')}\n`
    const split = whole.indexOf(lines[2] ?? '') + 10
    const first = foldTranscript(emptyTranscript(), whole.slice(0, split))
    expect(first.lines).toBe(2)
    expect(first.offset).toBe(Buffer.byteLength(`${lines[0]}\n${lines[1]}\n`))
    const second = foldTranscript(first, whole.slice(first.offset))
    expect(second.lines).toBe(4)
    expect(second.tokens).toBe(37 + 10)
    expect(second.frames.map(frame => [frame.seq, frame.label])).toEqual([[2, 'Bash: List files'], [3, 'Read b.ts']])
    expect(second.firstAt).toBe(at('2026-09-28T22:00:00.000Z'))
    expect(second.endedTurn).toBe(true)
    expect(foldTranscript(second, 'no newline yet')).toBe(second)
  })
})

describe('Branch CI and host readers', () => {
  it('keeps only runs and jobs carrying the fields it reads', () => {
    expect(parseCiRuns({ workflow_runs: [{ id: 1, head_sha: TIP, html_url: 'u', created_at: '2026-09-28T20:00:00Z', status: 'completed', conclusion: 'failure' }, { id: 'x' }, 7] })).toEqual([
      { id: 1, sha: TIP, status: 'completed', conclusion: 'failure', url: 'u', createdAt: '2026-09-28T20:00:00Z', updatedAt: '2026-09-28T20:00:00Z' },
    ])
    expect(parseCiRuns('nonsense')).toEqual([])
    expect(parseCiJobs({ jobs: [{ name: 'static', html_url: 'j', conclusion: 'failure' }, { name: 3 }] })).toEqual([{ name: 'static', url: 'j', conclusion: 'failure' }])
  })

  it('reads memory from meminfo and nothing from a text missing its fields', () => {
    expect(parseMeminfo('MemTotal: 1000 kB\nMemAvailable: 80 kB\nSwapTotal: 100 kB\nSwapFree: 25 kB\n')).toEqual({ availablePct: 8, swapUsedPct: 75 })
    expect(parseMeminfo('MemTotal: 1000 kB\n')).toBeUndefined()
  })
})

describe('rankAttention', () => {
  it('puts the worst severity first, then the newest with an undated condition as current, then orders by id', () => {
    const item = (id: string, severity: OpsAttention['severity'], when?: string): OpsAttention => ({
      id, kind: 'source-unknown', severity, title: id, detail: '', evidence: [], next: '', ...when === undefined ? {} : { at: when },
    })
    const ranked = rankAttention([
      item('b', 'medium', '2026-09-28T10:00:00Z'),
      item('a', 'critical'),
      item('c', 'medium', '2026-09-28T12:00:00Z'),
      item('d', 'high'),
      item('e', 'medium', '2026-09-28T12:00:00Z'),
    ])
    expect(ranked.map(entry => entry.id)).toEqual(['a', 'd', 'c', 'e', 'b'])
    expect(rankAttention([item('dated', 'high', '2026-09-28T12:00:00Z'), item('now', 'high')]).map(entry => entry.id)).toEqual(['now', 'dated'])
  })
})

describe('collectOps', () => {
  let base: string

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'enterprise-ops-'))
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  function write(path: string, content: string): void {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, content)
  }

  /** A machine with every source present: a cycle running a shift with one department working and one gone silent. */
  function machine(): OpsInputs {
    const root = join(base, 'repo')
    write(join(root, 'data/enterprise/roster.json'), JSON.stringify({
      divisions: [{ id: 'harness-core', name: 'Harness Core' }, { id: 'program-departments', name: 'Program Departments' }],
      agents: [
        { id: 'harness-core-agent-steward', name: 'Agent Steward', division: 'harness-core', source: 'packages/core/agent/README.md', status: 'active', evidence: { sessions: 0 }, ledger: { lines: 2 } },
        { id: 'harness-core-session-steward', name: 'Session Steward', division: 'harness-core', source: 'x', status: 'defined', evidence: { sessions: 0 }, ledger: { lines: 0 } },
        { id: 'program-departments-jobs-coordinator', name: 'Jobs Coordinator', division: 'program-departments', source: 'y', status: 'defined', evidence: { sessions: 1 }, ledger: { lines: 0 } },
      ],
    }))
    const ticketLine = (ticket: string, when: string, fields: Record<string, unknown>): Record<string, unknown> => ({
      type: 'ticket', at: when, shift: '182951-78a6', ticket, seat: 'harness-core-agent-steward', division: 'harness-core', checks: [], shipped: null, ...fields,
    })
    write(join(root, 'data/enterprise/ledger.jsonl'), jsonl([
      ticketLine('T-0001', '2026-09-28T19:04:29.582Z', { review: { verdict: 'approve', sessionId: 'review-t-0001-aa' }, shipped: { commit: SHIPPED }, reason: 'approved and assembled' }),
      ticketLine('T-0002', '2026-09-28T19:05:00.000Z', { review: { verdict: 'reject', sessionId: 'review-t-0002-bb' }, reason: 'out of scope' }),
      ticketLine('T-0003', '2026-09-28T19:06:00.000Z', { reason: 'halted: limit (resets at 2026-09-29T01:00:00Z)' }),
      { type: 'function', at: '2026-09-28T22:35:00.000Z', shift: 's', seat: 'harness-core-session-steward', division: 'harness-core', function: 'verify-md-links', target: { commit: TIP }, outcome: 'fail', evidence: { path: 'x.log' }, seconds: 60 },
    ]) + 'not json\n')
    write(join(root, 'data/enterprise/cycles/cycle-20260928T201148Z.json'), JSON.stringify({
      cycle: 'cycle-20260928T201148Z',
      startedAt: '2026-09-28T20:11:48.000Z',
      endedAt: '2026-09-28T20:40:00.000Z',
      commits: { start: TIP, pulled: TIP, end: TIP },
      steps: [{ name: 'pull', exit: 0, at: '2026-09-28T20:11:50Z' }, { name: 'functions', exit: 1, at: '2026-09-28T20:35:00Z' }],
      shifts: [],
      tickets: { shipped: 0, rejected: 0, halted: 0 },
      functions: { pass: 0, fail: 0, error: 0 },
      unreadable: 0,
      firstFailure: { step: 'functions', exit: 1 },
      previous: null,
    }))
    write(join(root, 'data/enterprise/requests/dark-deck.md'), '# Show the deck in dark mode\n\nPlease.\n')
    write(join(root, '.git/FETCH_HEAD'), '')
    utimesSync(join(root, '.git/FETCH_HEAD'), new Date('2026-09-28T22:36:00Z'), new Date('2026-09-28T22:36:00Z'))
    for (const id of ['T-0001', 'T-0002', 'T-0003', 'T-0004', 'T-0005']) {
      write(join(root, `data/enterprise/tickets/${id}.json`), JSON.stringify({ id, title: `Ticket ${id}`, seat: 'harness-core-agent-steward', division: 'harness-core' }))
    }

    const cyclesDir = join(base, 'cycles')
    write(join(cyclesDir, 'cycle-20260928T221300Z.log'), [
      'enterprise-cycle: cycle-20260928T221301Z pull exit=0 at 22:13:05Z',
      'enterprise-cycle: cycle-20260928T221301Z intake exit=0 at 22:15:00Z',
      'enterprise-cycle: cycle-20260928T221301Z intake-push exit=1 at 22:15:19Z',
      'enterprise: shift 221520-e979 → /tmp/dsh-enterprise/221520-e979',
    ].join('\n'))
    write(join(cyclesDir, 'scheduler.log'), 'enterprise-scheduler: next cycle at 2026-09-29T00:13:00Z\n')

    const scratch = join(base, 'scratch')
    write(join(scratch, 'shift.lock'), JSON.stringify({ pid: 4242, shift: '221520-e979' }))
    const sessions = join(scratch, '221520-e979/.sessions')
    write(join(sessions, 'a/program/session.jsonl'), jsonl([{ type: 'session', id: PROGRAM, createdAt: at('2026-09-28T22:15:20Z') }]))
    write(join(sessions, 'b/t1/session.jsonl'), jsonl([
      { type: 'session', id: `${PROGRAM}-t-0004`, createdAt: at('2026-09-28T22:15:21Z') },
      { type: 'tool/call', seq: 7, time: at('2026-09-28T22:38:00Z'), data: { name: 'bash', arguments: JSON.stringify({ description: 'Run typecheck' }) } },
      { type: 'assistant/chunk', seq: 8, time: at('2026-09-28T22:38:01Z'), data: { chunk: { type: 'usage', usage: { inputTokens: 1000, outputTokens: 50 } } } },
    ]))
    write(join(sessions, 'c/t2/session.jsonl'), jsonl([
      { type: 'session', id: `${PROGRAM}-t-0005`, createdAt: at('2026-09-28T22:15:21Z') },
      { type: 'tool/call', seq: 3, time: at('2026-09-28T22:16:00Z'), data: { name: 'bash', arguments: '{"description":"Wait for the gate"}' } },
    ]))

    const claudeProjects = join(base, 'claude')
    const operatorTree = '/home/user/deepseek-harness'
    const subagents = join(claudeProjects, claudeProjectName(operatorTree), 'session-1/subagents')
    write(join(subagents, 'agent-abc123.meta.json'), JSON.stringify({ description: 'Live Operations Center' }))
    write(join(subagents, 'agent-abc123.jsonl'), jsonl([
      { type: 'user', timestamp: '2026-09-28T22:20:00.000Z', message: { content: 'brief' } },
      { type: 'assistant', timestamp: '2026-09-28T22:39:30.000Z', message: { id: 'm1', usage: { input_tokens: 10, output_tokens: 20 }, content: [{ type: 'tool_use', name: 'Bash', input: { description: 'Build the deck' } }] } },
    ]))
    // A streamed transcript whose last row is the agent's final report: finished, however long ago it spoke.
    write(join(subagents, 'agent-def456.meta.json'), JSON.stringify({ description: 'Durable live transcript capture' }))
    write(join(subagents, 'agent-def456.jsonl'), jsonl([
      { type: 'user', timestamp: '2026-09-28T21:00:00.000Z', message: { content: 'brief' } },
      { type: 'assistant', timestamp: '2026-09-28T21:10:00.000Z', message: { id: 'm1', stop_reason: null, content: [{ type: 'tool_use', name: 'Bash', input: { description: 'Start the loop' } }] } },
      { type: 'user', timestamp: '2026-09-28T21:10:05.000Z', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
      { type: 'assistant', timestamp: '2026-09-28T21:11:00.000Z', message: { id: 'm2', stop_reason: null, content: [{ type: 'text', text: 'The loop runs; here is my report.' }] } },
    ]))
    // The running shift's clone of the branch carries committed records; they are history, not agents at work.
    write(join(scratch, '221520-e979/repo/data/proving-ground/2026-09-27-readme-rows-program/sessions/program-43bc855519f2bd12101b0b6073dabe31dba83c2e32b6eba89a1f03b0463f4e7f-readme-rows.jsonl'), jsonl([
      { type: 'session', id: 'program-43bc855519f2bd12101b0b6073dabe31dba83c2e32b6eba89a1f03b0463f4e7f-readme-rows', createdAt: at('2026-09-27T12:00:00Z') },
      { type: 'tool/call', seq: 2, time: at('2026-09-27T12:01:00Z'), data: { name: 'bash', arguments: '{}' } },
    ]))

    const processes: ProcessInfo[] = [
      { pid: 10, ppid: 1, cmdline: 'bash scripts/enterprise-scheduler.sh', startedAt: at('2026-09-28T20:00:00Z') },
      { pid: 11, ppid: 10, cmdline: 'bash scripts/enterprise-cycle.sh', startedAt: at('2026-09-28T22:13:00Z') },
      { pid: 12, ppid: 1, cmdline: 'bash scripts/transcripts-capture.sh', startedAt: at('2026-09-28T20:00:00Z') },
    ]
    const runs = {
      workflow_runs: [
        { id: 2, head_sha: TIP, html_url: 'https://github.com/run/2', created_at: '2026-09-28T22:20:00Z', updated_at: '2026-09-28T22:35:00Z', status: 'completed', conclusion: 'failure' },
        { id: 1, head_sha: 'e'.repeat(40), html_url: 'https://github.com/run/1', created_at: '2026-09-28T19:00:00Z', status: 'completed', conclusion: 'success' },
      ],
    }
    const jobs = { jobs: [{ name: 'static', html_url: 'https://github.com/job/9', conclusion: 'failure' }, { name: 'coverage', html_url: 'https://github.com/job/8', conclusion: 'success' }] }
    return {
      root,
      now: NOW,
      producer: 'cli',
      cyclesDir,
      scratch,
      claudeProjects,
      operatorTree,
      benchRoots: [],
      benchLog: join(base, 'nightly-loop.log'),
      branch: 'claude/coding-agent-harness-u9l4gt',
      stuckMs: 20 * 60_000,
      staleMs: 2.5 * 3_600_000,
      abandonMs: 30 * 60_000,
      opsLoopState: join(base, 'ops-live-state.json'),
      ciMaxAgeMs: 120_000,
      state: emptyOpsState(),
      github: async path => (path.includes('/jobs') ? jobs : runs),
      processes: () => processes,
      alive: pid => pid === 4242,
      memory: () => ({ availablePct: 7.5, swapUsedPct: 10 }),
      disks: () => [{ mount: '/', usedPct: 91.2, freeBytes: 5 * 1_073_741_824 }],
      git: args => (args[0] === 'rev-list' ? `${TIP}\n` : args[0] === 'rev-parse' ? '.git/FETCH_HEAD\n' : [
        `${TIP}\t2026-09-28T22:38:40Z\tchore(transcripts): live capture 2026-09-28T22:38:02Z`,
        `${TIP}\t2026-09-28T22:15:19Z\tchore(enterprise): cycle-20260928T221301Z intake`,
      ].join('\n')),
    }
  }

  it('lists every agent working now with its kind, seat, activity and tokens', async () => {
    const snapshot = await collectOps(machine())
    expect(snapshot.schema).toBe(2)
    expect(snapshot.agents.map(agent => [agent.kind, agent.label, agent.state])).toEqual([
      ['cycle-step', 'cycle-20260928T221301Z · shift', 'working'],
      ['department', 'T-0004 · Agent Steward', 'working'],
      ['department', 'T-0005 · Agent Steward', 'stuck'],
      ['operator-agent', 'Live Operations Center', 'working'],
    ])
    const department = snapshot.agents.find(agent => agent.label.startsWith('T-0004'))
    expect(department).toMatchObject({ seat: 'harness-core-agent-steward', division: 'harness-core', doing: 'bash: Run typecheck', tokens: 1050, idleSeconds: 119, run: 'shift 221520-e979' })
    expect(snapshot.agents.find(agent => agent.kind === 'operator-agent')).toMatchObject({ doing: 'Bash: Build the deck', tokens: 30 })
    expect(snapshot.activity.some(frame => frame.sessionId === `session:${PROGRAM}-t-0004` && frame.agentId === 'harness-core-agent-steward')).toBe(true)
  })

  it('publishes no path of the machine that collected it, and names a cycle by its id and committed record', async () => {
    const inputs = machine()
    const snapshot = await collectOps(inputs)
    // The fixture's machine keeps its files under a temporary directory, which the attention queue and the agents never name;
    // the operator's own tree (/home/user/deepseek-harness here) is a host path no string of the snapshot keeps.
    expect(JSON.stringify([snapshot.attention, snapshot.agents])).not.toContain(base)
    const text = JSON.stringify(snapshot)
    expect(text).not.toContain('/home/user')
    expect(text).not.toMatch(/"path":/)
    const failed = snapshot.attention.find(item => item.kind === 'cycle-step-failed')
    expect(failed?.evidence[0]).toEqual({ label: 'cycle-20260928T221301Z' })
    const running = snapshot.agents.find(agent => agent.kind === 'cycle-step')
    expect(running?.evidence).toEqual({ label: 'cycle-20260928T221301Z' })
    write(join(inputs.root, 'data/enterprise/cycles/cycle-20260928T221301Z.json'), '{}\n')
    const recorded = await collectOps({ ...machine(), state: emptyOpsState() })
    expect(recorded.attention.find(item => item.kind === 'cycle-step-failed')?.evidence[0]).toEqual({
      label: 'cycle-20260928T221301Z',
      url: 'https://github.com/LBJLincoln/deepseek-harness/blob/claude/coding-agent-harness-u9l4gt/data/enterprise/cycles/cycle-20260928T221301Z.json',
    })
  })

  it('never counts a finished agent or a committed record as working, so neither can be stuck', async () => {
    const snapshot = await collectOps(machine())
    expect(snapshot.agents.some(agent => agent.label === 'Durable live transcript capture')).toBe(false)
    expect(snapshot.runs.find(run => run.label === 'Durable live transcript capture')?.outcome).toBe('ok')
    expect(snapshot.agents.some(agent => agent.id.includes('readme-rows'))).toBe(false)
    expect(snapshot.attention.filter(item => item.kind === 'agent-stuck').map(item => item.title)).toEqual([expect.stringContaining('T-0005')])
  })

  it('reads a finished transcript again when its state was folded under another format', async () => {
    const inputs = machine()
    await collectOps(inputs)
    const file = join(base, 'ops-state.json')
    // An older collector cached the finished transcript as a turn still open, and a finished transcript never grows again.
    const transcripts = Object.fromEntries(
      Object.entries(inputs.state.transcripts).map(([path, state]) => [path, { ...state, endedTurn: false }]),
    )
    writeFileSync(file, JSON.stringify({ ...inputs.state, format: OPS_STATE_FORMAT - 1, transcripts }))
    const discarded = loadOpsState(file)
    expect(discarded).toEqual(emptyOpsState())
    const snapshot = await collectOps({ ...machine(), state: discarded })
    expect(snapshot.agents.some(agent => agent.label === 'Durable live transcript capture')).toBe(false)
    // A state of the current format is trusted as written.
    writeFileSync(file, JSON.stringify({ ...inputs.state, transcripts }))
    expect(loadOpsState(file).transcripts).toEqual(transcripts)
  })

  it('ranks the attention queue with evidence and a next action for each item', async () => {
    const snapshot = await collectOps(machine())
    expect(snapshot.attention.map(item => [item.severity, item.kind])).toEqual([
      ['high', 'disk-pressure'],
      ['high', 'memory-pressure'],
      ['high', 'ci-red'],
      ['high', 'agent-stuck'],
      ['high', 'cycle-step-failed'],
      ['medium', 'heartbeat-down'],
      ['medium', 'owner-request'],
      ['medium', 'ticket-halted'],
      ['low', 'ticket-rejected'],
    ])
    const request = snapshot.attention.find(item => item.kind === 'owner-request')
    expect(request?.title).toBe('Owner request waiting: Show the deck in dark mode')
    expect(request?.evidence[0]?.url).toBe('https://github.com/LBJLincoln/deepseek-harness/blob/claude/coding-agent-harness-u9l4gt/data/enterprise/requests/dark-deck.md')
    const red = snapshot.attention.find(item => item.kind === 'ci-red')
    expect(red?.detail).toBe('Failing job: static.')
    expect(red?.evidence.map(link => link.url)).toContain('https://github.com/job/9')
    const halted = snapshot.attention.find(item => item.kind === 'ticket-halted')
    expect(halted?.next).toContain('2026-09-29T01:00:00Z')
    expect(halted?.evidence[0]?.url).toBe('https://github.com/LBJLincoln/deepseek-harness/blob/claude/coding-agent-harness-u9l4gt/data/enterprise/ledger.jsonl#L3')
    for (const item of snapshot.attention) expect(item.next.length).toBeGreaterThan(0)
  })

  it('counts the big picture from the roster, the queue, the ledger, the cycles and Branch CI', async () => {
    const snapshot = await collectOps(machine())
    expect(snapshot.big.seats).toMatchObject({ defined: 3, occupied: 2, activeToday: 1, workingNow: 1 })
    expect(snapshot.big.tickets).toEqual({ queued: 2, halted: 1, shipped: 1, rejected: 1 })
    expect(snapshot.big.cycles).toEqual({ last24h: 2, lastStartedAt: '2026-09-28T22:13:00.000Z', running: 'cycle-20260928T221301Z', nextAt: '2026-09-29T00:13:00.000Z' })
    // The older cycle's log is gone; its record still places its steps, and its failure is not the newest word.
    expect(snapshot.runs.find(run => run.id === 'cycle:cycle-20260928T201148Z:functions')).toMatchObject({ outcome: 'failed', startedAt: '2026-09-28T20:11:50.000Z', endedAt: '2026-09-28T20:35:00Z' })
    expect(snapshot.attention.some(item => item.id === 'cycle-step:cycle-20260928T201148Z:functions')).toBe(false)
    expect(snapshot.big.shipped).toEqual([{ commit: SHIPPED, at: '2026-09-28T19:04:29.582Z', tickets: ['T-0001'], ci: 'fail', ciCommit: TIP, url: 'https://github.com/run/2' }])
    expect(snapshot.big.ci?.latest).toMatchObject({ commit: TIP, conclusion: 'failure', failingJobs: [{ name: 'static', url: 'https://github.com/job/9' }] })
    expect(snapshot.big.throughput?.hours).toHaveLength(24)
    expect(snapshot.big.throughput?.shippedPerHour).toBe(0.04)
    expect(snapshot.sources.find(source => source.id === 'ledger')?.detail).toBe('4 lines, 1 unreadable and skipped')
    expect(snapshot.sources.find(source => source.id === 'requests')?.detail).toBe('1 owner request, 1 open')
    // Each source dates its facts: the checkout's newest fetch, the roster's own time, the Branch CI read, the collection.
    expect(Object.fromEntries(snapshot.sources.map(source => [source.id, source.asOf]))).toMatchObject({
      roster: '2026-09-28T22:36:00.000Z', ledger: '2026-09-28T22:36:00.000Z', requests: '2026-09-28T22:36:00.000Z', ci: NOW.toISOString(), shifts: NOW.toISOString(),
    })
    expect(snapshot.runs.map(run => run.id)).toEqual(expect.arrayContaining(['cycle:cycle-20260928T221301Z:intake-push', `session:${PROGRAM}-t-0004`, 'operator:abc123']))
  })

  it('reports an unreadable source as unknown and guesses nothing from it', async () => {
    const empty: OpsInputs = {
      ...machine(),
      root: join(base, 'nowhere'),
      cyclesDir: join(base, 'no-cycles'),
      scratch: join(base, 'no-scratch'),
      claudeProjects: join(base, 'no-claude'),
      processes: () => undefined,
      memory: () => undefined,
      disks: () => [],
      git: () => undefined,
    }
    delete empty.github
    const snapshot = await collectOps(empty)
    const states = Object.fromEntries(snapshot.sources.map(source => [source.id, source.state]))
    expect(states).toEqual({
      roster: 'unknown', ledger: 'unknown', tickets: 'unknown', 'cycle-logs': 'unknown', 'cycle-history': 'unknown', scheduler: 'unknown',
      shifts: 'unknown', 'department-transcripts': 'unknown', 'operator-agents': 'unknown', bench: 'unknown', ci: 'unknown', host: 'unknown', requests: 'unknown',
    })
    expect(snapshot.big).toEqual({
      seats: null, tickets: null, cycles: null, throughput: null, shipped: null, shippedTickets: null, ci: null, host: null,
    })
    expect([snapshot.cycles, snapshot.shift]).toEqual([null, null])
    expect(snapshot.agents).toEqual([])
    expect(snapshot.attention).toEqual([])
    expect(snapshot.sources.every(source => source.asOf === undefined)).toBe(true)
    // A checkout that cannot be dated leaves its files' facts undated rather than dated now.
    const undated = await collectOps({ ...machine(), git: () => undefined })
    expect(undated.sources.find(source => source.id === 'ledger')).toEqual({ id: 'ledger', state: 'ok', detail: '4 lines, 1 unreadable and skipped' })
    expect(snapshot.heartbeats.map(beat => [beat.id, beat.state, beat.lastRunAt])).toEqual([
      ['scheduler', 'unknown', undefined], ['transcript-capture', 'unknown', undefined], ['ops-loop', 'unknown', undefined],
    ])
  })

  it('keeps the last Branch CI reading when a later read fails, and says so', async () => {
    const inputs = machine()
    await collectOps(inputs)
    const later: OpsInputs = { ...inputs, now: new Date(NOW.getTime() + 600_000), github: async () => { throw new Error('GET /repos answered 503') } }
    const snapshot = await collectOps(later)
    expect(snapshot.big.ci?.latest?.commit).toBe(TIP)
    expect(snapshot.sources.find(source => source.id === 'ci')?.detail).toContain('the newest read failed: GET /repos answered 503')
    const first: OpsInputs = { ...machine(), github: async () => { throw new Error('offline') } }
    const unread = await collectOps(first)
    expect(unread.big.ci).toBeNull()
    expect(unread.sources.find(source => source.id === 'ci')).toEqual({ id: 'ci', state: 'unknown', detail: 'GitHub could not be read: offline' })
  })

  it('flags a stale and stopped scheduler as critical and an interrupted cycle as high', async () => {
    const inputs = machine()
    const snapshot = await collectOps({ ...inputs, now: new Date('2026-09-29T02:00:00.000Z'), processes: () => [] })
    const kinds = snapshot.attention.map(item => [item.severity, item.kind])
    expect(kinds).toContainEqual(['critical', 'scheduler-stale'])
    expect(kinds).toContainEqual(['high', 'cycle-interrupted'])
    expect(snapshot.agents.some(agent => agent.kind === 'cycle-step')).toBe(false)
  })

  it('beats each background loop\'s heart from its process and its newest run', async () => {
    const snapshot = await collectOps(machine())
    expect(snapshot.heartbeats.map(beat => [beat.id, beat.state, beat.lastRunAt])).toEqual([
      ['scheduler', 'alive', '2026-09-28T22:13:00.000Z'],
      ['transcript-capture', 'alive', '2026-09-28T22:38:02.000Z'],
      ['ops-loop', 'down', undefined],
    ])
    expect(snapshot.attention.find(item => item.kind === 'heartbeat-down')).toMatchObject({ id: 'heartbeat:ops-loop', severity: 'medium', title: 'The operations loop is not running' })
    const inputs = machine()
    const loop: ProcessInfo = { pid: 13, ppid: 1, cmdline: 'bash scripts/enterprise-ops-live.sh', startedAt: at('2026-09-28T22:00:00Z') }
    // The capture is late only against what the checkout could see: its newest fetch is 27 minutes after the newest capture.
    utimesSync(join(inputs.root, '.git/FETCH_HEAD'), new Date('2026-09-28T23:05:00Z'), new Date('2026-09-28T23:05:00Z'))
    const live = await collectOps({ ...inputs, producer: 'loop', intervalSeconds: 15, processes: () => [...inputs.processes() ?? [], loop], now: new Date('2026-09-28T23:10:00.000Z') })
    expect(live.heartbeats.map(beat => [beat.id, beat.state])).toEqual([['scheduler', 'alive'], ['transcript-capture', 'late'], ['ops-loop', 'alive']])
    expect(live.heartbeats[2]).toMatchObject({ lastRunAt: '2026-09-28T23:10:00.000Z', everySeconds: 15 })
    expect(live.attention.find(item => item.kind === 'heartbeat-down')).toMatchObject({ id: 'heartbeat:transcript-capture', severity: 'low' })
  })

  it('flags halted, failed and abandoned shifts from their records and scratch runs', async () => {
    const inputs = machine()
    const record = (name: string, result: Record<string, unknown>): void => {
      write(join(inputs.root, `data/enterprise/shifts/${name}/result.json`), JSON.stringify({ type: 'result', shift: name.slice(-11), ...result }))
      write(join(inputs.root, `data/enterprise/shifts/${name}/manifest.json`), JSON.stringify({ endedAt: result.endedAt }))
    }
    const ticket = (id: string, shipped: boolean, reason: string): Record<string, unknown> => ({ type: 'ticket', ticket: id, shipped: shipped ? { commit: SHIPPED } : null, reason })
    record('2026-09-28-120000-0001', { startedAt: '2026-09-28T12:00:00Z', endedAt: '2026-09-28T12:40:00Z', report: { outcome: 'failed' }, halt: null, tickets: [ticket('T-0009', false, 'no certificate')] })
    record('2026-09-28-140000-0002', { startedAt: '2026-09-28T14:00:00Z', endedAt: '2026-09-28T14:40:00Z', report: { outcome: 'released' }, halt: null, tickets: [ticket('T-0010', true, 'approved and assembled')] })
    record('2026-09-28-160000-0003', { startedAt: '2026-09-28T16:00:00Z', endedAt: '2026-09-28T16:30:00Z', report: { outcome: 'halted' }, halt: { kind: 'limit', resetsAt: '2026-09-28T21:00:00Z' }, tickets: [ticket('T-0011', false, 'halted: limit')] })
    record('2026-09-28-180000-0004', { startedAt: '2026-09-28T18:00:00Z', endedAt: '2026-09-28T18:20:00Z', report: null, halt: null, reason: 'the driver crashed in the assembly', tickets: ['T-0012'] })
    const abandoned = join(inputs.scratch, '200000-abcd')
    write(join(abandoned, 'run.log'), 'enterprise: shift 200000-abcd\n')
    for (const path of [join(abandoned, 'run.log'), abandoned]) utimesSync(path, new Date('2026-09-28T21:00:00Z'), new Date('2026-09-28T21:00:00Z'))
    const snapshot = await collectOps(inputs)
    const shifts = snapshot.attention.filter(item => item.kind.startsWith('shift-'))
    expect(shifts.map(item => [item.severity, item.kind, item.title])).toEqual([
      ['high', 'shift-abandoned', 'Shift 200000-abcd was abandoned'],
      ['high', 'shift-halted', 'Shift 160000-0003 halted at its usage limit'],
      ['medium', 'shift-failed', 'Shift 180000-0004 shipped nothing'],
    ])
    expect(shifts[1]?.next).toBe('Its tickets stay open; the first cycle after 2026-09-28T21:00:00Z takes them again.')
    expect(shifts[2]?.detail).toBe('the driver crashed in the assembly.')
    expect(shifts[2]?.evidence[0]?.url).toBe('https://github.com/LBJLincoln/deepseek-harness/blob/claude/coding-agent-harness-u9l4gt/data/enterprise/shifts/2026-09-28-180000-0004/result.json')
    // The live shift holds the lock, so it is not abandoned.
    expect(shifts.some(item => item.id === 'shift-abandoned:221520-e979')).toBe(false)
  })

  it('lays out the window\'s cycles newest first with each step\'s exit status, the running one\'s steps to come included', async () => {
    const snapshot = await collectOps(machine())
    expect(snapshot.cycles?.map(cycle => [cycle.cycle, cycle.outcome, cycle.source])).toEqual([
      ['cycle-20260928T221301Z', 'running', 'log'],
      ['cycle-20260928T201148Z', 'failed', 'record'],
    ])
    const running = snapshot.cycles?.[0]
    expect(running?.steps.map(step => [step.name, step.state, step.exit])).toEqual([
      ['pull', 'ok', 0], ['intake', 'ok', 0], ['intake-push', 'failed', 1], ['shift', 'running', undefined],
      ['pull-after-shift', 'pending', undefined], ['functions', 'pending', undefined], ['roster', 'pending', undefined],
      ['publish', 'pending', undefined], ['record', 'pending', undefined], ['push', 'pending', undefined],
    ])
    expect(running?.steps[0]).toMatchObject({ at: '2026-09-28T22:13:05.000Z', seconds: 5 })
    expect(running?.steps[3]).toMatchObject({ at: '2026-09-28T22:15:19.000Z', seconds: 1481 })
    expect(running).toMatchObject({ shift: '221520-e979', evidence: { label: 'cycle-20260928T221301Z' } })
    expect(snapshot.cycles?.[1]).toMatchObject({
      endedAt: '2026-09-28T20:40:00.000Z',
      tickets: { shipped: 0, rejected: 0, halted: 0 },
      steps: [{ name: 'pull', state: 'ok', exit: 0, seconds: 2 }, { name: 'functions', state: 'failed', exit: 1, seconds: 1390 }],
    })
    // The scheduler's exit code marks a cycle whose steps all passed as failed; a refused cycle keeps its reason.
    const inputs = machine()
    write(join(inputs.cyclesDir, 'cycle-20260928T180000Z.log'), 'enterprise-cycle: the checkout has uncommitted changes to tracked files; refusing to run\n')
    write(join(inputs.cyclesDir, 'cycle-20260928T160000Z.log'), 'enterprise-cycle: cycle-20260928T160000Z pull exit=0 at 16:00:02Z\n')
    write(join(inputs.cyclesDir, 'scheduler.log'), 'enterprise-scheduler: cycle-20260928T180000Z exit=5 at 18:00:01Z\nenterprise-scheduler: cycle-20260928T160000Z exit=128 at 16:00:03Z\n')
    const more = await collectOps(inputs)
    expect(more.cycles?.slice(2).map(cycle => [cycle.cycle, cycle.outcome, cycle.exit, cycle.detail])).toEqual([
      ['cycle-20260928T180000Z', 'refused', 5, 'the checkout has uncommitted changes'],
      ['cycle-20260928T160000Z', 'failed', 128, undefined],
    ])
    const unread = await collectOps({ ...machine(), cyclesDir: join(base, 'no-cycles'), git: () => undefined })
    expect(unread.cycles).toBeNull()
  })

  it('follows the running shift\'s tickets through the department, the review and the integration', async () => {
    const inputs = machine()
    const sessions = join(inputs.scratch, '221520-e979/.sessions')
    write(join(sessions, `x/${PROGRAM}/session.jsonl`), jsonl([
      { type: 'session', id: PROGRAM, createdAt: at('2026-09-28T22:15:20Z') },
      { type: 'program/start', seq: 0, time: at('2026-09-28T22:15:20Z'), data: { spec: { goals: [{ key: 't-0004' }, { key: 't-0005' }, { key: 't-0006', objective: 'Ticket T-0006: Pin the error codes' }, { key: 't-0007' }] } } },
      { type: 'program/goal', seq: 1, time: at('2026-09-28T22:15:21Z'), data: { key: 't-0004', status: 'running' } },
      { type: 'program/goal', seq: 2, time: at('2026-09-28T22:20:00Z'), data: { key: 't-0005', status: 'certified' } },
      { type: 'program/goal', seq: 3, time: at('2026-09-28T22:21:00Z'), data: { key: 't-0007', status: 'blocked', reason: 'budget-exhausted' } },
    ]))
    write(join(sessions, 'r/review-t-0005-aa/session.jsonl'), jsonl([
      { type: 'session', id: 'review-t-0005-aa', createdAt: at('2026-09-28T22:21:00Z') },
      { type: 'assistant/message', seq: 1, time: at('2026-09-28T22:25:00Z'), data: { message: { content: [{ type: 'text', text: 'verdict: approve' }] } } },
      { type: 'turn/end', seq: 2, time: at('2026-09-28T22:25:00Z'), data: {} },
    ]))
    const snapshot = await collectOps(inputs)
    expect(snapshot.shift).toMatchObject({ shift: '221520-e979', state: 'running', source: 'scratch', startedAt: '2026-09-28T22:15:20.000Z', evidence: { label: 'shift 221520-e979 run.log' } })
    const stages = snapshot.shift?.tickets.map(entry => [entry.ticket, entry.stage, entry.since, entry.title, entry.reached, entry.reason])
    expect(stages).toEqual([
      ['T-0004', 'working', '2026-09-28T22:15:21.000Z', 'Ticket T-0004', undefined, undefined],
      ['T-0005', 'integration', '2026-09-28T22:25:00.000Z', 'Ticket T-0005', undefined, undefined],
      ['T-0006', 'queued', undefined, 'Pin the error codes', undefined, undefined],
      ['T-0007', 'halted', '2026-09-28T22:21:00.000Z', undefined, 'working', 'budget-exhausted'],
    ])
    expect(snapshot.shift?.tickets[0]).toMatchObject({ seat: 'harness-core-agent-steward', division: 'harness-core' })
  })

  it('shows the newest committed shift once none runs, each ticket where it stopped', async () => {
    const inputs = machine()
    const name = '2026-09-28-221600-0005'
    write(join(inputs.root, `data/enterprise/shifts/${name}/result.json`), JSON.stringify({
      type: 'result',
      shift: '221600-0005',
      startedAt: '2026-09-28T22:16:00Z',
      tickets: [
        { type: 'ticket', ticket: 'T-0001', shipped: { commit: SHIPPED }, review: { verdict: 'approve' }, integration: { outcome: 'assembled' } },
        { type: 'ticket', ticket: 'T-0002', shipped: null, department: { outcome: 'certified' }, review: { verdict: 'reject' }, integration: { outcome: 'skipped' }, reason: 'out of scope' },
        { type: 'ticket', ticket: 'T-0003', shipped: null, department: { outcome: 'certified' }, review: { verdict: 'approve' }, integration: { outcome: 'checks-failed' }, reason: 'acceptance failed over the assembled tree' },
        { type: 'ticket', ticket: 'T-0009', shipped: null, department: { outcome: 'blocked' }, review: { verdict: 'none' }, integration: { outcome: 'skipped' }, reason: 'budget-exhausted' },
      ],
    }))
    write(join(inputs.root, `data/enterprise/shifts/${name}/manifest.json`), JSON.stringify({ endedAt: '2026-09-28T22:39:00Z' }))
    const scratchRun = join(inputs.scratch, '221520-e979')
    utimesSync(scratchRun, new Date('2026-09-28T22:15:20Z'), new Date('2026-09-28T22:15:20Z'))
    const snapshot = await collectOps({ ...inputs, alive: () => false })
    expect(snapshot.shift).toMatchObject({ shift: '221600-0005', state: 'ended', source: 'record', startedAt: '2026-09-28T22:16:00.000Z', endedAt: '2026-09-28T22:39:00.000Z' })
    expect(snapshot.shift?.evidence.url).toBe(`https://github.com/LBJLincoln/deepseek-harness/blob/claude/coding-agent-harness-u9l4gt/data/enterprise/shifts/${name}/result.json`)
    expect(snapshot.shift?.tickets.map(ticket => [ticket.ticket, ticket.stage, ticket.reached, ticket.commit, ticket.reason])).toEqual([
      ['T-0001', 'shipped', undefined, SHIPPED, undefined],
      ['T-0002', 'rejected', 'review', undefined, 'out of scope'],
      ['T-0003', 'halted', 'integration', undefined, 'acceptance failed over the assembled tree'],
      ['T-0009', 'halted', 'working', undefined, 'budget-exhausted'],
    ])
    // A push rebased after the record was written: the ledger names the commit that reached the branch.
    const rebased = {
      type: 'ticket', at: '2026-09-28T22:38:00.000Z', shift: '221600-0005', ticket: 'T-0001', seat: 'harness-core-agent-steward', division: 'harness-core',
      checks: [], shipped: { commit: TIP }, reason: 'approved and assembled', recordedBy: 'supervisor', recordedAt: '2026-09-28T22:39:30.000Z',
    }
    writeFileSync(join(inputs.root, 'data/enterprise/ledger.jsonl'), `${readFileSync(join(inputs.root, 'data/enterprise/ledger.jsonl'), 'utf8')}${JSON.stringify(rebased)}\n`)
    const recorded = await collectOps({ ...inputs, alive: () => false, state: emptyOpsState() })
    expect(recorded.shift?.tickets[0]).toMatchObject({ ticket: 'T-0001', stage: 'shipped', commit: TIP, recordedBy: 'supervisor' })
    const none = await collectOps({ ...machine(), scratch: join(base, 'no-scratch'), root: join(base, 'nowhere') })
    expect(none.shift).toBeNull()
  })

  it('flags a shift that assembled tickets but could not push, and never counts them as shipped', async () => {
    const inputs = machine()
    const run = join(inputs.scratch, '221520-e979')
    write(join(run, 'run.log'), [
      '=== 2026-09-28T22:15:20.000Z shift=221520-e979 ===',
      JSON.stringify({
        type: 'result',
        shift: '221520-e979',
        error: 'the shift could not finalize or push: Command failed: git fetch --quiet origin\nfatal: unable to access the remote',
        repo: `${run}/repo`,
        tickets: [
          { type: 'ticket', ticket: 'T-0004', shipped: { commit: TIP }, review: { verdict: 'approve' }, integration: { outcome: 'assembled' }, reason: 'approved and assembled' },
          { type: 'ticket', ticket: 'T-0005', shipped: null, department: { outcome: 'blocked' }, reason: 'budget-exhausted' },
        ],
      }),
    ].join('\n'))
    const snapshot = await collectOps({ ...inputs, alive: () => false })
    const item = snapshot.attention.find(entry => entry.id === 'shift-unpushed:221520-e979')
    expect(item).toMatchObject({ kind: 'shift-failed', severity: 'high', title: 'Shift 221520-e979 assembled T-0004 but did not push', evidence: [{ label: 'shift 221520-e979 run.log' }] })
    expect(item?.detail).toContain('the ticket is still open')
    expect(item?.next).toContain('leave T-0004 open for the next shift')
    // The same scratch run is not also flagged as abandoned once its silence passes the threshold.
    const later = await collectOps({ ...inputs, alive: () => false, now: new Date(NOW.getTime() + 3_600_000) })
    expect(later.attention.filter(entry => entry.id.endsWith(':221520-e979')).map(entry => entry.id)).toEqual(['shift-unpushed:221520-e979'])
    expect(snapshot.shift).toMatchObject({ shift: '221520-e979', state: 'ended', source: 'scratch' })
    expect(snapshot.shift?.tickets.map(entry => [entry.ticket, entry.stage, entry.reached, entry.commit])).toEqual([
      ['T-0004', 'halted', 'integration', undefined],
      ['T-0005', 'halted', 'working', undefined],
    ])
    expect(snapshot.shift?.tickets[0]?.reason).toMatch(/^assembled, but the shift did not push it: the shift could not finalize or push/)

    // Once the supervisor pushes the kept clone and records the ledger lines, the ledger is what reached the branch.
    const recovered = {
      type: 'ticket', at: '2026-09-28T22:30:00.000Z', shift: '221520-e979', ticket: 'T-0004', seat: 'harness-core-agent-steward', division: 'harness-core',
      checks: [], shipped: { commit: SHIPPED }, reason: 'approved and assembled', recordedBy: 'supervisor', recordedAt: '2026-09-28T22:38:00.000Z',
    }
    writeFileSync(join(inputs.root, 'data/enterprise/ledger.jsonl'), `${readFileSync(join(inputs.root, 'data/enterprise/ledger.jsonl'), 'utf8')}${JSON.stringify(recovered)}\n`)
    const after = await collectOps({ ...inputs, alive: () => false, state: emptyOpsState() })
    expect(after.attention.some(entry => entry.id.endsWith(':221520-e979'))).toBe(false)
    expect(after.shift?.tickets[0]).toMatchObject({ ticket: 'T-0004', stage: 'shipped', commit: SHIPPED, since: '2026-09-28T22:30:00.000Z', recordedBy: 'supervisor' })
    expect(after.shift?.tickets[0]?.reached).toBeUndefined()
    expect(after.shift?.tickets[1]).toMatchObject({ ticket: 'T-0005', stage: 'halted' })
    expect(after.big.shippedTickets?.[0]).toMatchObject({ ticket: 'T-0004', shift: '221520-e979', commit: SHIPPED, recordedBy: 'supervisor' })
  })

  it('settles a failed shift step once the shift\'s lines are recorded after the fact', async () => {
    const inputs = machine()
    write(join(inputs.cyclesDir, 'cycle-20260928T223000Z.log'), [
      'enterprise-cycle: cycle-20260928T223000Z pull exit=0 at 2026-09-28T22:30:01Z',
      'enterprise: shift 223005-abcd → /tmp/dsh-enterprise/223005-abcd',
      'enterprise-cycle: cycle-20260928T223000Z shift exit=1 at 2026-09-28T22:35:00Z',
      'enterprise-cycle: cycle-20260928T223000Z pull-after-shift exit=1 at 2026-09-28T22:35:01Z',
      'enterprise-cycle: cycle-20260928T223000Z done, first failure exit=1',
    ].join('\n'))
    const failed = await collectOps(inputs)
    expect(failed.attention.filter(item => item.id.startsWith('cycle-step:cycle-20260928T223000Z')).map(item => item.severity)).toEqual(['high', 'high'])
    const line = {
      type: 'ticket', at: '2026-09-28T22:34:00.000Z', shift: '223005-abcd', ticket: 'T-0004', seat: 'harness-core-agent-steward', division: 'harness-core',
      checks: [], shipped: { commit: TIP }, reason: 'approved and assembled', recordedBy: 'supervisor', recordedAt: '2026-09-28T22:38:00.000Z',
    }
    writeFileSync(join(inputs.root, 'data/enterprise/ledger.jsonl'), `${readFileSync(join(inputs.root, 'data/enterprise/ledger.jsonl'), 'utf8')}${JSON.stringify(line)}\n`)
    const settled = await collectOps({ ...inputs, state: emptyOpsState() })
    const items = settled.attention.filter(item => item.id.startsWith('cycle-step:cycle-20260928T223000Z'))
    expect(items.map(item => [item.severity, item.title])).toEqual([
      ['low', 'cycle-20260928T223000Z: pull-after-shift exited 1; the supervisor recorded shift 223005-abcd afterwards'],
      ['low', 'cycle-20260928T223000Z: shift exited 1; the supervisor recorded shift 223005-abcd afterwards'],
    ])
    expect(items[0]?.detail).toBe('The shift\'s ledger lines reached the branch at 22:38 UTC, written after the fact by the supervisor.')
  })

  it('lists each shipped ticket with its commit and the verdict enterprise:verdicts gives it', async () => {
    const inputs = machine()
    // A run cancelled on the commit itself renders no verdict; the first later run that rendered one does.
    const cancelled = { id: 3, head_sha: SHIPPED, html_url: 'https://github.com/run/3', created_at: '2026-09-28T19:05:00Z', status: 'completed', conclusion: 'cancelled' }
    const runs = { workflow_runs: [
      { id: 2, head_sha: TIP, html_url: 'https://github.com/run/2', created_at: '2026-09-28T22:20:00Z', updated_at: '2026-09-28T22:35:00Z', status: 'completed', conclusion: 'failure' },
      cancelled,
    ] }
    const withCancelled: OpsInputs = { ...inputs, github: async path => (path.includes('/jobs') ? { jobs: [] } : runs) }
    const snapshot = await collectOps(withCancelled)
    expect(snapshot.big.shippedTickets).toEqual([{
      ticket: 'T-0001', title: 'Ticket T-0001', seat: 'harness-core-agent-steward', division: 'harness-core', shift: '182951-78a6', at: '2026-09-28T19:04:29.582Z',
      commit: SHIPPED, ci: 'fail', url: 'https://github.com/run/2', ciCommit: TIP,
    }])
    // The cycle's report paged further back than the collector's one read, so its rendered answer stands.
    write(join(inputs.root, 'apps/command-deck/public/fixtures/enterprise-day.json'), JSON.stringify({ commits: [
      { commit: SHIPPED, ci: { basis: 'later', run: { id: 1, headSha: 'f'.repeat(40), conclusion: 'success', url: 'https://github.com/run/1' }, superseded: [] } },
    ] }))
    const reported = await collectOps({ ...withCancelled, state: emptyOpsState() })
    expect(reported.big.shippedTickets?.[0]).toMatchObject({ ci: 'pass', url: 'https://github.com/run/1', ciCommit: 'f'.repeat(40) })
    expect(reported.big.shipped?.[0]).toMatchObject({ ci: 'pass', ciCommit: 'f'.repeat(40) })
    // With no rendered run covering it, a later run in progress says so.
    rmSync(join(inputs.root, 'apps/command-deck/public/fixtures/enterprise-day.json'))
    const busy = { workflow_runs: [{ id: 4, head_sha: TIP, html_url: 'https://github.com/run/4', created_at: '2026-09-28T22:30:00Z', status: 'in_progress', conclusion: null }] }
    const running = await collectOps({ ...machine(), state: emptyOpsState(), github: async path => (path.includes('/jobs') ? { jobs: [] } : busy) })
    expect(running.big.shippedTickets?.[0]).toMatchObject({ ci: 'running', url: 'https://github.com/run/4', ciCommit: TIP })
  })

  it('dates the transcript capture by the newest push its log records', async () => {
    const inputs = machine()
    write(join(inputs.cyclesDir, 'transcripts-capture.log'), 'transcripts-capture: 2026-09-28T22:34:56Z pushed 148490ce5 at 22:35:03Z\ntranscripts-capture: 2026-09-28T22:39:56Z the push lock /tmp/dsh-push.lock is busy; this round captures and commits locally and pushes nothing\n')
    const snapshot = await collectOps(inputs)
    const capture = snapshot.heartbeats.find(beat => beat.id === 'transcript-capture')
    expect(capture).toMatchObject({ state: 'alive', lastRunAt: '2026-09-28T22:35:03.000Z', lastPush: { at: '2026-09-28T22:35:03.000Z', commit: '148490ce5' } })
    expect(capture?.detail).toContain('its newest round did not push: the push lock dsh-push.lock is busy')
  })

  it('keeps the transcript and record reads it can reuse in its state', async () => {
    const inputs = machine()
    const state: OpsState = inputs.state
    await collectOps(inputs)
    const transcript = Object.keys(state.transcripts).find(file => file.endsWith('agent-abc123.jsonl'))
    expect(transcript === undefined ? undefined : state.transcripts[transcript]?.lines).toBe(2)
    expect(state.ci?.runs).toHaveLength(2)
  })
})

describe('parseOpsArgs', () => {
  it('defaults the producer from the output and refuses a bad number', () => {
    expect(parseOpsArgs(['--fixture'], {}).producer).toBe('cycle')
    expect(parseOpsArgs(['--push', '--interval', '15'], {}).producer).toBe('loop')
    expect(parseOpsArgs([], { ENTERPRISE_CYCLE_LOGS: '/logs' })).toMatchObject({ producer: 'cli', cyclesDir: '/logs', stuckMinutes: 20, staleHours: 2.5, abandonMinutes: 30, ci: true })
    expect(() => parseOpsArgs(['--stuck-minutes', '0'], {})).toThrow('--stuck-minutes must be a positive number')
    expect(() => parseOpsArgs(['--bogus'], {})).toThrow()
  })
})
