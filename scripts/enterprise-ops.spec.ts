import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { OpsAttention } from '../apps/command-deck/deck/contract.ts'
import { collectOps, parseOpsArgs, rankAttention, sessionRole, type OpsInputs, type OpsState } from './enterprise-ops.ts'
import {
  claudeProjectName,
  currentCycleStep,
  cyclesFromHistory,
  describeToolCall,
  emptyTranscript,
  foldHarnessSession,
  foldTranscript,
  parseCiJobs,
  parseCiRuns,
  parseCycleLog,
  parseJsonl,
  parseMeminfo,
  parseSchedulerLog,
  publicLine,
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

  it('reads the scheduler\'s newest announced slot', () => {
    expect(parseSchedulerLog('enterprise-scheduler: next cycle at 2026-09-28T22:13:00Z\nenterprise-scheduler: next cycle at 2026-09-29T00:13:00Z\n').nextAt).toBe('2026-09-29T00:13:00.000Z')
    expect(parseSchedulerLog('').nextAt).toBeUndefined()
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

    const processes: ProcessInfo[] = [
      { pid: 10, ppid: 1, cmdline: 'bash scripts/enterprise-scheduler.sh', startedAt: at('2026-09-28T20:00:00Z') },
      { pid: 11, ppid: 10, cmdline: 'bash scripts/enterprise-cycle.sh', startedAt: at('2026-09-28T22:13:00Z') },
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
      ciMaxAgeMs: 120_000,
      state: { transcripts: {}, records: {} },
      github: async path => (path.includes('/jobs') ? jobs : runs),
      processes: () => processes,
      alive: pid => pid === 4242,
      memory: () => ({ availablePct: 7.5, swapUsedPct: 10 }),
      disks: () => [{ mount: '/', usedPct: 91.2, freeBytes: 5 * 1_073_741_824 }],
      git: args => (args[0] === 'rev-list' ? `${TIP}\n` : `${TIP}\t2026-09-28T22:15:19Z\tchore(enterprise): cycle-20260928T221301Z intake\n`),
    }
  }

  it('lists every agent working now with its kind, seat, activity and tokens', async () => {
    const snapshot = await collectOps(machine())
    expect(snapshot.schema).toBe(1)
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

  it('ranks the attention queue with evidence and a next action for each item', async () => {
    const snapshot = await collectOps(machine())
    expect(snapshot.attention.map(item => [item.severity, item.kind])).toEqual([
      ['high', 'disk-pressure'],
      ['high', 'memory-pressure'],
      ['high', 'ci-red'],
      ['high', 'agent-stuck'],
      ['high', 'cycle-step-failed'],
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
    expect(snapshot.big).toEqual({ seats: null, tickets: null, cycles: null, throughput: null, shipped: null, ci: null, host: null })
    expect(snapshot.agents).toEqual([])
    expect(snapshot.attention).toEqual([])
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
    expect(parseOpsArgs([], { ENTERPRISE_CYCLE_LOGS: '/logs' })).toMatchObject({ producer: 'cli', cyclesDir: '/logs', stuckMinutes: 20, staleHours: 2.5, ci: true })
    expect(() => parseOpsArgs(['--stuck-minutes', '0'], {})).toThrow('--stuck-minutes must be a positive number')
    expect(() => parseOpsArgs(['--bogus'], {})).toThrow()
  })
})
