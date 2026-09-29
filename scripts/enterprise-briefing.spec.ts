import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  BRIEFING_SCHEMA,
  buildBriefing,
  describeArms,
  DigestBook,
  divisionRows,
  experimentRows,
  pilotRows,
  pooledRows,
  readCi,
  readInputs,
  recallAgainst,
  recallRows,
  reviewRows,
  serializeBriefing,
  shiftRows,
  signoffRows,
  termsRows,
  ticketsByStatus,
  tierRows,
  writeIfChanged,
  type BriefingInputs,
  type CiReading,
  type Figure,
  type GitReader,
  type ShiftRecordInput,
} from './enterprise-briefing.ts'
import { checkSummary, renderSummary } from './enterprise-briefing-summary.ts'
import type { GitHubReader } from './enterprise-functions.ts'
import type { FunctionLine, LedgerRead, TicketLine } from './enterprise-ledger.ts'
import type { Roster } from './enterprise-roster.ts'

const root = resolve(import.meta.dirname, '..')
const SHIPPED = '1d6a5d3430aef9893b1a28adfea1f1841238c866'
const BASE = 'd2cc487f7bc83a8aa3f7c56ec7733f8ddf392631'
const PUSH = '52c56001dc2b8f1e0000000000000000000000aa'
const FIX = '2f7ba31d7000000000000000000000000000000bb'
const SCRIPTS = { cycle: '2026-09-28T20:10:45.000Z', scheduler: '2026-09-28T20:41:16.000Z' }

function agent(id: string, division: string, overrides: { sessions?: number; lines?: number; status?: 'defined' | 'active' } = {}): Roster['agents'][number] {
  return {
    id,
    name: id.split('-').map(word => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(' '),
    role: 'steward',
    division,
    route: { provider: 'claude-code', model: 'sonnet' },
    preset: 'coding',
    skills: [],
    tools: [],
    source: 'README.md',
    status: overrides.status ?? 'defined',
    evidence: { sessions: overrides.sessions ?? 0, routesSeen: [] },
    ledger: { lines: overrides.lines ?? 0 },
  }
}

function roster(): Roster {
  return {
    generatedAt: '2026-09-28T20:00:00.000Z',
    counts: { defined: 4, occupied: 3, active: 1 },
    activeWindow: { since: '2026-09-27T20:00:00.000Z', until: '2026-09-28T20:00:00.000Z' },
    divisions: [
      { id: 'harness-core', name: 'Harness Core', purpose: 'Stewards the spine.' },
      { id: 'judging', name: 'Judging', purpose: 'Decides at each CI gate.' },
    ],
    agents: [
      agent('harness-core-llm-steward', 'harness-core', { lines: 1, status: 'active' }),
      agent('harness-core-agent-steward', 'harness-core'),
      agent('judging-ci-static', 'judging', { lines: 2 }),
      agent('judging-ci-coverage', 'judging', { sessions: 3 }),
    ],
    edges: [],
    evidence: { records: ['a', 'b'], sessions: 12, routes: { 'claude-code': 9, 'openrouter': 1 } },
    unattributed: { sessions: 0, reasons: {} },
    ledger: { path: 'data/enterprise/ledger.jsonl', lines: 3, unseated: 0 },
  } as unknown as Roster
}

function ticketLine(overrides: Partial<TicketLine>): TicketLine {
  return {
    type: 'ticket',
    at: '2026-09-28T19:04:29.582Z',
    shift: '182951-78a6',
    ticket: 'T-0012',
    seat: 'harness-core-llm-steward',
    division: 'harness-core',
    model: 'Claude Code sonnet',
    checks: [{ id: 'coverage', ok: true }, { id: 'typecheck', ok: true }],
    review: { verdict: 'approve', sessionId: 'review-t-0012-fb58af6f' },
    integration: { outcome: 'merged' },
    shipped: { commit: SHIPPED },
    reason: 'approved and assembled',
    tokens: 1_000_000,
    seconds: 500,
    ...overrides,
  }
}

function functionLine(overrides: Partial<FunctionLine>): FunctionLine {
  return {
    type: 'function',
    at: '2026-09-28T17:50:00.000Z',
    shift: '2026-09-28T17-47Z',
    seat: 'judging-ci-static',
    division: 'judging',
    function: 'ci-static',
    target: { commit: BASE },
    outcome: 'pass',
    evidence: { url: 'https://github.com/example/job/1' },
    seconds: 180,
    ...overrides,
  }
}

function shiftRecord(overrides: Partial<ShiftRecordInput> = {}): ShiftRecordInput {
  return {
    dir: 'data/enterprise/shifts/2026-09-28-182951-78a6',
    result: { type: 'result', shift: '182951-78a6', startedAt: '2026-09-28T18:29:53.155Z', base: BASE, tickets: [ticketLine({})], redacted: 0 },
    manifest: { startedAt: '2026-09-28T18:29:53.155Z', endedAt: '2026-09-28T19:04:29.582Z', base: BASE },
    sessions: [
      { file: 'data/enterprise/shifts/2026-09-28-182951-78a6/sessions/program-x.jsonl', dataUseTerms: false, toolCalls: 0, signoffs: [
        { transition: 'spec-freeze', principal: 'enterprise-operator', kind: 'human', time: Date.parse('2026-09-28T18:31:28.024Z') },
        { transition: 'release', principal: 'enterprise-operator', kind: 'human', time: Date.parse('2026-09-28T18:31:28.025Z') },
      ] },
      { file: 'data/enterprise/shifts/2026-09-28-182951-78a6/sessions/review-t-0012-fb58af6f.jsonl', dataUseTerms: false, toolCalls: 0, signoffs: [] },
    ],
    ...overrides,
  }
}

function inputs(overrides: Partial<BriefingInputs> = {}): BriefingInputs {
  const ledger: LedgerRead = { lines: [functionLine({}), ticketLine({})], skipped: [] }
  return {
    roster: roster(),
    ledger,
    tickets: [
      { file: 'data/enterprise/tickets/T-0012.json', value: { id: 'T-0012', title: 'Drop an export', seat: 'harness-core-llm-steward', division: 'harness-core' } },
      { file: 'data/enterprise/tickets/T-0013.json', value: { id: 'T-0013', title: 'Another', seat: 'harness-core-agent-steward', division: 'harness-core' } },
    ],
    shifts: [shiftRecord()],
    intakes: [{ dir: 'data/enterprise/intake/2026-09-28-201151-a5d5', result: { id: '201151-a5d5', at: '2026-09-28T20:11:51.582Z', outcome: 'nothing-needed', open: 39, minOpen: 8 } }],
    commits: [{ sha: 'c1', at: '2026-09-28T20:11:51.000Z', subject: 'chore(enterprise): cycle-20260928T201148Z intake' }],
    cycleRecords: [],
    shiftStarts: [],
    logs: [],
    scripts: SCRIPTS,
    bench: { environments: [{ id: 'code:a', tier: 5, domain: 'parsing', heldOut: false }, { id: 'code:b', tier: 6, domain: 'build', heldOut: false }], results: [], folds: [], records: 3 },
    safety: { records: [], groundTruths: {} },
    sessions: { bench: [], codeSafety: [], shifts: [], intake: [] },
    digests: [],
    ...overrides,
  }
}

/**
 * @param figure - a figure.
 * @returns its reason when it is unknown, else `undefined`.
 */
function unknownOf(figure: Figure<unknown> | undefined): string | undefined {
  return figure !== undefined && 'unknown' in figure ? figure.unknown : undefined
}

function ancestry(pairs: readonly [string, string][]): GitReader {
  return { isAncestor: (ancestor, descendant) => ancestor === descendant || pairs.some(([a, d]) => a === ancestor && d === descendant) }
}

const RUNS = {
  total_count: 4,
  workflow_runs: [
    { id: 4, head_sha: FIX, status: 'completed', conclusion: 'success', created_at: '2026-09-28T19:25:17Z', updated_at: '2026-09-28T19:40:22Z', html_url: 'https://ci/4' },
    { id: 3, head_sha: PUSH, status: 'completed', conclusion: 'failure', created_at: '2026-09-28T19:05:08Z', updated_at: '2026-09-28T19:17:35Z', html_url: 'https://ci/3' },
    { id: 2, head_sha: BASE, status: 'completed', conclusion: 'failure', created_at: '2026-09-28T17:38:48Z', updated_at: '2026-09-28T17:50:16Z', html_url: 'https://ci/2' },
    { id: 1, head_sha: 'aaaaaaaaa', status: 'completed', conclusion: 'cancelled', created_at: '2026-09-28T17:00:00Z', updated_at: '2026-09-28T17:10:00Z', html_url: 'https://ci/1' },
  ],
}

const JOBS: Record<number, unknown> = {
  2: { jobs: [{ id: 21, name: 'node 24 / static', conclusion: 'success', html_url: 'https://job/21' }, { id: 22, name: 'node 24 / snapshots and artifacts', conclusion: 'failure', html_url: 'https://job/22' }] },
  3: { jobs: [{ id: 31, name: 'node 24 / static', conclusion: 'failure', html_url: 'https://job/31' }, { id: 32, name: 'node 24 / snapshots and artifacts', conclusion: 'failure', html_url: 'https://job/32' }] },
  4: { jobs: [{ id: 41, name: 'node 24 / static', conclusion: 'success', html_url: 'https://job/41' }] },
}

const LOGS: Record<number, string> = {
  22: '2026-09-28T17:40:00Z run-gates: ci-consumers running 9 gate(s)\n2026-09-28T17:41:00Z   - FAILED test:snapshot (12.0s, exit 1)\n',
  31: '2026-09-28T19:06:00Z run-gates: ci-static running 37 gate(s)\n2026-09-28T19:07:00Z   - FAILED translation pairing (2.0s, exit 1)\n',
  32: '2026-09-28T19:06:00Z run-gates: ci-consumers running 9 gate(s)\n2026-09-28T19:07:00Z   - FAILED test:snapshot (12.0s, exit 1)\n',
}

function github(overrides: Partial<GitHubReader> = {}): GitHubReader & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    json: async (path) => {
      calls.push(path)
      if (path.includes('/workflows/')) return RUNS
      if (/^\/repos\/[^/]+\/[^/]+$/.test(path)) return { visibility: 'public', private: false }
      const run = Number(/\/runs\/(\d+)\/jobs/.exec(path)?.[1])
      const jobs = JOBS[run]
      if (jobs === undefined) throw new Error(`no jobs for ${path}`)
      return jobs
    },
    text: async (path) => {
      calls.push(path)
      const log = LOGS[Number(/\/jobs\/(\d+)\/logs/.exec(path)?.[1])]
      if (log === undefined) throw new Error(`no log for ${path}`)
      return log
    },
    ...overrides,
  }
}

const GIT = ancestry([[SHIPPED, PUSH], [SHIPPED, FIX], [BASE, PUSH], [BASE, FIX]])

describe('enterprise figures', () => {
  it('counts defined, occupied and active seats per division by the occupancy rule', () => {
    expect(divisionRows(roster())).toEqual([
      { id: 'harness-core', name: 'Harness Core', purpose: 'Stewards the spine.', defined: 2, occupied: 1, active: 1 },
      { id: 'judging', name: 'Judging', purpose: 'Decides at each CI gate.', defined: 2, occupied: 2, active: 0 },
    ])
  })

  it('takes each ticket status from its newest line and counts a ticket without a line as queued', () => {
    const ledger: LedgerRead = {
      lines: [
        ticketLine({ ticket: 'T-0001', at: '2026-09-28T10:00:00.000Z', shipped: null, review: { verdict: 'none' } }),
        ticketLine({ ticket: 'T-0001', at: '2026-09-28T12:00:00.000Z' }),
        ticketLine({ ticket: 'T-0002', shipped: null, review: { verdict: 'reject' } }),
        ticketLine({ ticket: 'T-0003', shipped: null, review: { verdict: 'none' }, reason: 'halted: limit' }),
      ],
      skipped: [],
    }
    const queue = ['T-0001', 'T-0002', 'T-0003', 'T-0004'].map(id => ({ file: `${id}.json`, value: { id } }))
    expect(ticketsByStatus(queue, ledger)).toEqual({ queued: ['T-0004'], shipped: ['T-0001'], rejected: ['T-0002'], halted: ['T-0003'] })
  })

  it('reads a shift record, its duration and a partial record\'s reason', () => {
    const partial = shiftRecord({ dir: 'data/enterprise/shifts/p', result: { type: 'partial', shift: '171951-516d', startedAt: '2026-09-28T17:19:51.258Z', endedAt: '2026-09-28T18:19:48Z', tickets: ['T-0012'], reason: 'the driver crashed', redacted: 0 }, sessions: [] })
    const [first, second] = shiftRows([shiftRecord(), partial])
    expect(first).toMatchObject({ shift: '171951-516d', type: 'partial', tickets: ['T-0012'], shipped: [], reason: 'the driver crashed', seconds: 3597 })
    expect(second).toMatchObject({ shift: '182951-78a6', type: 'result', tickets: ['T-0012'], shipped: ['T-0012'], seconds: 2076, redacted: 0 })
  })

  describe('the pilot', () => {
    const halted = (ticket: string): TicketLine => ticketLine({
      shift: '221520-e979',
      ticket,
      at: '2026-09-28T22:53:59.804Z',
      shipped: null,
      review: { verdict: 'none' },
      checks: [{ id: 'coverage', ok: true }, { id: 'doc-sync', ok: false }],
      reason: 'no certificate after 3 rounds',
      tokens: 300_000,
    })
    const records = [
      shiftRecord({
        dir: 'data/enterprise/shifts/2026-09-28-171951-516d',
        result: { type: 'partial', shift: '171951-516d', startedAt: '2026-09-28T17:19:51.258Z', endedAt: '2026-09-28T18:19:48Z', tickets: ['T-0012', 'T-0019'] },
      }),
      shiftRecord({ result: { type: 'result', shift: '182951-78a6', startedAt: '2026-09-28T18:29:53.155Z', tickets: [ticketLine({}), ticketLine({ ticket: 'T-0019' })] } }),
      shiftRecord({
        dir: 'data/enterprise/shifts/2026-09-28-221520-e979',
        result: { type: 'result', shift: '221520-e979', startedAt: '2026-09-28T22:15:21.531Z', tickets: [halted('T-0001'), halted('T-0022')] },
      }),
    ]
    const ledger: LedgerRead = { lines: [ticketLine({}), ticketLine({ ticket: 'T-0019', tokens: 500_000 }), halted('T-0001'), halted('T-0022')], skipped: [] }
    const commits = [
      { sha: 'c1', at: '2026-09-28T20:11:51.000Z', subject: 'chore(enterprise): cycle-20260928T201148Z intake' },
      { sha: 'c2', at: '2026-09-28T22:13:03.000Z', subject: 'chore(enterprise): cycle-20260928T221301Z intake' },
    ]
    const cycleLog = [
      'enterprise-cycle: cycle-20260928T221301Z pull exit=0 at 22:13:02Z',
      'enterprise-cycle: cycle-20260928T221301Z intake-push exit=0 at 2026-09-28T22:15:19Z',
      'noise from a step',
      'enterprise-cycle: cycle-20260928T221301Z shift exit=2 at 2026-09-28T22:55:04Z',
      '',
    ].join('\n')
    const logs = [
      { name: 'scheduler.log', dir: 'data/transcripts/live/enterprise-cycles/2026-09-28/enterprise-cycles_scheduler.log-3a', text: 'enterprise-scheduler: next cycle at 2026-09-28T22:13:00Z\n' },
      { name: 'cycle-20260928T221300Z.log', dir: 'data/transcripts/live/enterprise-cycles/2026-09-28/enterprise-cycles_cycle-20260928T221300Z.log-93', text: cycleLog },
    ]

    it('puts every cycle and every shift outside a cycle in one list, with who started it and what its shifts did', () => {
      const rows = pilotRows({ commits, ledger, cycleRecords: [], logs, scripts: SCRIPTS }, shiftRows(records))
      expect(rows.map(row => [row.id, row.kind, row.startedBy])).toEqual([
        ['171951-516d', 'shift', 'operator'],
        ['182951-78a6', 'shift', 'operator'],
        ['cycle-20260928T201148Z', 'cycle', 'operator'],
        ['cycle-20260928T221301Z', 'cycle', 'scheduler'],
      ])
      expect(rows[0]).toMatchObject({ attempted: 2, shipped: [], failed: [], lost: 2, tokens: null, finished: null })
      expect(rows[0]?.basis).toContain('before scripts/enterprise-cycle.sh reached the branch')
      expect(rows[1]).toMatchObject({ attempted: 2, shipped: ['T-0012', 'T-0019'], lost: 0, tokens: 1_500_000 })
      expect(rows[2]).toMatchObject({ shifts: [], attempted: null, lost: null, steps: [], finished: false })
      expect(rows[2]?.basis).toContain('before scripts/enterprise-scheduler.sh reached the branch')
      expect(rows[3]).toMatchObject({
        shifts: ['221520-e979'],
        attempted: 2,
        shipped: [],
        failed: [
          { ticket: 'T-0001', status: 'halted', failedChecks: ['doc-sync'], reason: 'no certificate after 3 rounds' },
          { ticket: 'T-0022', status: 'halted', failedChecks: ['doc-sync'], reason: 'no certificate after 3 rounds' },
        ],
        lost: 0,
        tokens: 600_000,
        finished: false,
      })
      expect(rows[3]?.steps).toEqual([
        { name: 'pull', exit: 0, at: '2026-09-28T22:13:02.000Z' },
        { name: 'intake-push', exit: 0, at: '2026-09-28T22:15:19.000Z' },
        { name: 'shift', exit: 2, at: '2026-09-28T22:55:04.000Z' },
      ])
      expect(rows[3]?.basis).toContain('announced the slot 2026-09-28T22:13:00.000Z')
      expect(rows[3]?.paths).toEqual([
        'data/enterprise/ledger.jsonl',
        'data/enterprise/shifts/2026-09-28-221520-e979',
        logs[1]?.dir,
        logs[0]?.dir,
      ])
    })

    it('takes a recorded cycle\'s shifts from its record, and a cycle whose steps ran no shift as attempting none', () => {
      const record = {
        cycle: 'cycle-20260929T001301Z',
        startedAt: '2026-09-29T00:13:01.000Z',
        endedAt: '2026-09-29T01:10:00.000Z',
        commits: { start: 'a'.repeat(40), pulled: 'a'.repeat(40), end: 'b'.repeat(40) },
        steps: [{ name: 'intake', exit: 3, at: '2026-09-29T00:20:00Z' }, { name: 'record', exit: 0, at: '2026-09-29T01:10:00Z' }],
        shifts: [],
        tickets: { shipped: 0, rejected: 0, halted: 0 },
        functions: { pass: 0, fail: 0, error: 0 },
        unreadable: 0,
        firstFailure: { step: 'intake', exit: 3 },
        previous: null,
      }
      const scheduler = { ...logs[0], text: 'enterprise-scheduler: cycle-20260928T221300Z exit=2 at 23:59:00Z\n' } as (typeof logs)[number]
      const rows = pilotRows({ commits, ledger, cycleRecords: [record], logs: [scheduler], scripts: SCRIPTS }, shiftRows(records))
      const recorded = rows.find(row => row.id === record.cycle)
      expect(recorded).toMatchObject({ startedBy: 'unknown', shifts: [], attempted: 0, lost: 0, tokens: null, finished: true, paths: ['data/enterprise/ledger.jsonl', `data/enterprise/cycles/${record.cycle}.json`, scheduler.dir] })
      expect(recorded?.basis).toBe('No captured scheduler log covers its start.')
      const stated = pilotRows({ commits, ledger, cycleRecords: [{ ...record, startedBy: 'operator' as const }], logs: [scheduler], scripts: SCRIPTS }, shiftRows(records))
      const statedRow = stated.find(row => row.id === record.cycle)
      expect(statedRow?.startedBy).toBe('operator')
      expect(statedRow?.basis).toContain('Its cycle record states operator')
      const running = pilotRows({ commits, ledger, cycleRecords: [], logs: [{ ...logs[1], text: 'enterprise-cycle: cycle-20260928T221301Z intake exit=0 at 22:14:00Z\n' } as (typeof logs)[number]], scripts: SCRIPTS }, [])
      expect(running.find(row => row.id === 'cycle-20260928T221301Z')).toMatchObject({ attempted: null, lost: null, finished: false })
      expect(rows.find(row => row.id === 'cycle-20260928T221301Z')?.basis).toContain('reports running the cycle whose log it stamped 2026-09-28T22:13:00.000Z')
    })

    it('stands a shift start line with no record for its shift, counting its abandoned lines and the tickets no line records', () => {
      const line = ticketLine({ shift: '230000-dead', ticket: 'T-0005', shipped: null, reason: 'abandoned: container reset', checks: [], at: '2026-09-29T01:00:00.000Z' })
      delete line.review
      delete line.tokens
      const start = { shift: '230000-dead', at: '2026-09-28T23:00:00.000Z', tickets: ['T-0005', 'T-0006'] }
      const ledger: LedgerRead = { lines: [line], skipped: [] }
      const rows = pilotRows({ commits: [], ledger, cycleRecords: [], logs: [], scripts: SCRIPTS, shiftStarts: [start] }, [])
      expect(rows).toMatchObject([{
        id: '230000-dead',
        kind: 'shift',
        startedBy: 'operator',
        attempted: 2,
        failed: [{ ticket: 'T-0005', status: 'halted', failedChecks: [], reason: 'abandoned: container reset' }],
        lost: 1,
        tokens: null,
        paths: ['data/enterprise/ledger.jsonl', 'data/enterprise/shift-starts.jsonl'],
      }])
    })

    it('reassembles the scheduler\'s log from the committed live capture', { timeout: 120_000 }, () => {
      expect(readInputs(root, []).logs.find(log => log.name === 'scheduler.log')?.text).toMatch(/^enterprise-scheduler: next cycle at /m)
    })
  })
})

describe('Proving Ground figures', () => {
  const sonnet = { model: { model: 'sonnet' }, implementer: { kind: 'route' } }
  it('names a pair by the one arm field that differs', () => {
    expect(describeArms(sonnet, { ...sonnet, model: { model: 'opus' } })).toEqual({ group: 'model', baseline: 'sonnet', candidate: 'opus' })
    expect(describeArms(sonnet, { ...sonnet, implementer: { kind: 'subagent', label: 'product-loop' } })).toEqual({ group: 'loop', baseline: 'harness loop', candidate: "the product's own loop" })
    expect(describeArms({ ...sonnet, ladder: [{}, {}, {}] }, { ...sonnet, ladder: [{}] })).toEqual({ group: 'attempts', baseline: '3 attempts', candidate: '1 attempt' })
    expect(describeArms({ ...sonnet, model: { model: 'opus' }, ladder: [{}, {}, {}] }, { ...sonnet, model: { model: 'haiku' }, ladder: [{ share: 0.2 }, { model: { model: 'opus' } }, { model: { model: 'opus' } }] }))
      .toEqual({ group: 'hand-off', baseline: 'opus, opus, opus', candidate: 'haiku (20% of the caps), opus, opus' })
    expect(describeArms({ ...sonnet, ladder: [{}] }, { ...sonnet, ladder: [{ selfReview: 'probe' }] })).toEqual({ group: 'method', baseline: '1 attempt', candidate: '1 attempt + probe-review turn' })
    expect(describeArms({ ...sonnet, preset: 'bench' }, { ...sonnet, preset: 'bench-craft' })).toEqual({ group: 'method', baseline: 'preset bench', candidate: 'preset bench-craft' })
  })

  it('reads each frozen pair with its certificates per arm, skips a pair without cells, and attaches a re-read fold', () => {
    const result = (plan: string, pairs: number) => ({
      plan,
      result: {
        verdict: 'promote',
        delta: 0.125,
        interval: { lower: 0.125, upper: 0.125 },
        arms: { baseline: { ...sonnet, ladder: [{}, {}, {}] }, candidate: { ...sonnet, ladder: [{}, {}, {}, {}, {}] } },
        cells: pairs === 0 ? [] : [{ pairs, baselineRate: 0.5, candidateRate: 1 }, { pairs, baselineRate: 1, candidateRate: 1 }],
      },
    })
    const rows = experimentRows(
      [
        { file: 'data/proving-ground/2026-09-21-bench-e7-attempts-5-t5/result.json', value: result('e7-attempts-5-t5', 2) },
        { file: 'data/proving-ground/2026-09-08-bench-e5-handoff-drop-t5/result.json', value: result('e5-handoff-drop-t5', 0) },
      ],
      [{ file: 'data/proving-ground/folds/reread.json', value: { reading: 'reread', records: [{ record: '2026-09-21-bench-e7-attempts-5-t5' }], result: { delta: 0.125, interval: { lower: 0, upper: 0.375 }, verdict: 'inconclusive', statistic: 'paired-cluster-bootstrap/1' } } }],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ group: 'attempts', baseline: '3 attempts', candidate: '5 attempts', tiers: 'tier 5', pairs: 4, baselineCertified: 3, candidateCertified: 4, verdict: 'promote', statistic: null })
    expect(rows[0]?.reread).toEqual({ fold: 'data/proving-ground/folds/reread.json', delta: 0.125, interval: { lower: 0, upper: 0.375 }, verdict: 'inconclusive', statistic: 'paired-cluster-bootstrap/1' })
  })

  it('reads a pooled fold', () => {
    expect(pooledRows([{ file: 'f.json', value: { reading: 'pooled-reread', plan: 'e7', records: [{ record: 'a' }, { record: 'b' }], result: { seedsPaired: 48, delta: 0.0417, interval: { lower: -0.0833, upper: 0.1875 }, verdict: 'inconclusive', statistic: 's' } } }]))
      .toEqual([{ fold: 'f.json', plan: 'e7', records: ['a', 'b'], pairs: 48, delta: 0.0417, interval: { lower: -0.0833, upper: 0.1875 }, verdict: 'inconclusive', statistic: 's' }])
  })
})

describe('code-safety figures', () => {
  const issues = [
    { id: 'A', file: 'app/a.js', lines: [10, 12] as [number, number] },
    { id: 'B', file: 'app/b.js', lines: [40, 40] as [number, number], alsoAt: [{ file: 'app/c.js', lines: [5, 5] as [number, number] }] },
    { id: 'C', file: 'app/d.js', lines: [1, 1] as [number, number] },
  ]

  it('counts an issue found within three lines of its range or of an alsoAt location, in the same file only', () => {
    expect(recallAgainst([{ file: 'app/a.js', line: 15 }, { file: 'app/c.js', line: 2 }, { file: 'app/b.js', line: 1 }], issues)).toEqual({ found: ['A', 'B'], missed: ['C'] })
    expect(recallAgainst([{ file: 'app/a.js', line: 16 }, { file: 'app/x.js', line: 1 }], issues)).toEqual({ found: [], missed: ['A', 'B', 'C'] })
  })

  it('reads each record against its target\'s ground truth and each comparison tier by the same rule', () => {
    const safety: BriefingInputs['safety'] = {
      records: [
        { name: '2026-09-21-nodegoat-3', manifest: { elapsedSeconds: 1356, certified: ['a', 'b'], departments: [{}], verifier: { exitCode: 0 } }, findings: [{ file: 'app/a.js', line: 10 }] },
        { name: '2026-09-28-dsh-self-review', manifest: {}, findings: [] },
      ],
      groundTruths: { nodegoat: { issues, target: 'OWASP NodeGoat' } },
      comparison: {
        value: { tiers: [{ id: 'semgrep', name: 'Semgrep', wall: 'seconds', cost: '$0' }, { id: 'single-model', name: 'One model' }, { id: 'enterprise', name: 'Daliesk', detail: '7 certified; record 2026-09-21-nodegoat-3', cost: 'subscription' }], iterations: [] },
        semgrep: [],
        singleModel: [{ file: 'app/a.js', line: 11 }, { file: 'app/d.js', line: 1 }],
        singleModelMeta: { cost_usd: 0.3591392, duration_ms: 113387 },
      },
    }
    expect(recallRows(safety)).toEqual([{ record: '2026-09-21-nodegoat-3', date: '2026-09-21', target: 'OWASP NodeGoat', knownIssues: 3, found: 1, missed: ['B', 'C'], findings: 1, elapsedSeconds: 1356, certified: 2, departments: 2, examinerExit: 0, iteration: null }])
    const read = tierRows(safety)?.map(tier => [
      tier.id, tier.found, tier.findings, tier.verifiedAtLine, tier.wall, tier.wallSeconds, tier.cost, tier.costUsd,
    ])
    expect(read).toEqual([
      ['semgrep', 0, 0, false, 'seconds', null, '$0', null],
      ['single-model', 2, 2, false, null, 113, null, 0.36],
      ['enterprise', 1, 1, true, null, 1356, 'subscription', null],
    ])
    expect(tierRows({ ...safety, groundTruths: {} })).toBeUndefined()
  })

  it('reproduces the committed comparison\'s scores from the committed findings', { timeout: 120_000 }, () => {
    const real = readInputs(root, []).safety
    const comparison = real.comparison?.value
    expect(comparison).toBeDefined()
    const byRecord = new Map(recallRows(real).map(row => [row.record, row.found]))
    for (const iteration of comparison?.iterations as { record: string; found: number }[]) {
      expect(byRecord.get(iteration.record.split('/').at(-1) ?? '')).toBe(iteration.found)
    }
    expect(tierRows(real)?.map(tier => tier.found)).toEqual((comparison?.tiers as { found: number }[]).map(tier => tier.found))
    expect(tierRows(real)?.map(tier => tier.onKnown)).toEqual((comparison?.tiers as { onKnown: number }[]).map(tier => tier.onKnown))
  })
})

describe('governance figures', () => {
  it('counts sessions pinning data-use terms, sign-off events and recorded decisions, and reviewer tool calls', () => {
    const scan = (file: string, dataUseTerms: boolean) => ({ file, dataUseTerms, toolCalls: 0, signoffs: [] })
    expect(termsRows({ bench: [scan('a', true), scan('b', false)], codeSafety: [scan('c', false)], shifts: [], intake: [] }))
      .toEqual([{ family: 'bench', sessions: 2, withTerms: 1 }, { family: 'codeSafety', sessions: 1, withTerms: 0 }, { family: 'shifts', sessions: 0, withTerms: 0 }, { family: 'intake', sessions: 0, withTerms: 0 }])
    const first = shiftRecord({ result: { shift: '171951-516d' }, sessions: [{ file: 'x/sessions/review-t-0012-79328c42.jsonl', dataUseTerms: false, toolCalls: 6, signoffs: [] }] })
    expect(reviewRows([first, shiftRecord()])).toEqual([{ shift: '171951-516d', reviews: 1, toolCalls: 6 }, { shift: '182951-78a6', reviews: 1, toolCalls: 0 }])
    const decided = shiftRecord({
      result: {
        shift: '011500-aaaa',
        decisions: [
          { transition: 'spec-freeze', principal: { kind: 'machine', id: 'daliesk-enterprise-shift', decidedBy: 'the engine' }, artefactSha256: 'a' },
          { transition: 'release', principal: { kind: 'machine', id: 'daliesk-enterprise-shift', decidedBy: 'the engine' }, artefactSha256: 'a' },
          { transition: 'release' },
        ],
      },
      sessions: [],
    })
    const intake = { dir: 'data/enterprise/intake/2026-09-28-181210-eedd', result: { id: '181210-eedd' } }
    const intakeLog = { file: `${intake.dir}/sessions/program-y.jsonl`, dataUseTerms: false, toolCalls: 0, signoffs: [{ transition: 'release', principal: 'enterprise-intake-operator', kind: 'human', time: Date.parse('2026-09-28T18:13:00.000Z') }] }
    const otherLog = { ...intakeLog, file: 'data/enterprise/intake/2026-09-28-201151-a5d5/sessions/program-z.jsonl' }
    expect(signoffRows([decided, shiftRecord()], [intake], [intakeLog, otherLog])).toEqual([
      { run: '181210-eedd', record: 'intake', transition: 'release', principal: 'enterprise-intake-operator', kind: 'human', at: '2026-09-28T18:13:00.000Z', form: 'event' },
      { run: '182951-78a6', record: 'shift', transition: 'spec-freeze', principal: 'enterprise-operator', kind: 'human', at: '2026-09-28T18:31:28.024Z', form: 'event' },
      { run: '182951-78a6', record: 'shift', transition: 'release', principal: 'enterprise-operator', kind: 'human', at: '2026-09-28T18:31:28.025Z', form: 'event' },
      { run: '011500-aaaa', record: 'shift', transition: 'spec-freeze', principal: 'daliesk-enterprise-shift', kind: 'machine', at: null, form: 'decision' },
      { run: '011500-aaaa', record: 'shift', transition: 'release', principal: 'daliesk-enterprise-shift', kind: 'machine', at: null, form: 'decision' },
    ])
  })
})

describe('Branch CI', () => {
  it('reads the carrying run, the base run and the first green run, and splits introduced from pre-existing failures', async () => {
    const reader = github()
    const ci = await readCi(reader, GIT, [{ commit: SHIPPED, base: BASE }], 'dev')
    expect(ci.failure).toBeUndefined()
    expect(ci.runs.map(run => run.id)).toEqual([1, 2, 3, 4])
    const verdict = ci.shipments.get(SHIPPED)
    if (verdict === undefined || verdict instanceof Error) throw new Error('no verdict')
    expect(verdict.exact).toBeNull()
    expect(verdict.carrying?.id).toBe(3)
    expect(verdict.carrying?.jobs.map(job => [job.name, job.failedGates])).toEqual([['node 24 / snapshots and artifacts', ['test:snapshot']], ['node 24 / static', ['translation pairing']]])
    expect(verdict.base?.id).toBe(2)
    expect(verdict.firstGreen?.id).toBe(4)
    expect(verdict.introduced).toEqual(['translation pairing'])
    expect(verdict.preExisting).toEqual(['test:snapshot'])
    expect(reader.calls.filter(call => call.endsWith('/logs'))).toHaveLength(3)
  })

  it('reads a run on exactly the shipped commit apart from the earliest run that contains it', async () => {
    const onCommit = { id: 5, head_sha: SHIPPED, status: 'completed', conclusion: 'failure', created_at: '2026-09-28T19:30:00Z', updated_at: '2026-09-28T19:41:00Z', html_url: 'https://ci/5' }
    const base = github()
    const reader = github({ json: async path => (path.includes('/workflows/') ? { total_count: 5, workflow_runs: [onCommit, ...RUNS.workflow_runs] } : base.json(path)) })
    const verdict = (await readCi(reader, GIT, [{ commit: SHIPPED, base: BASE }], 'dev')).shipments.get(SHIPPED)
    expect(verdict).toMatchObject({ exact: { id: 5, conclusion: 'failure' }, carrying: { id: 3 }, firstGreen: { id: 4 } })
  })

  it('leaves every CI figure unknown when the run list cannot be read, and the rest of the briefing unchanged', async () => {
    const reader = github({ json: async () => { throw new Error('GET answered 403') } })
    const ci = await readCi(reader, GIT, [{ commit: SHIPPED, base: BASE }], 'dev')
    expect(ci.failure).toContain('403')
    const briefing = buildBriefing(inputs(), ci)
    expect(briefing.ci.value).toBeNull()
    expect(unknownOf(briefing.ci)).toContain('403')
    expect(briefing.figures['ci.completed']).toMatchObject({ value: null })
    expect(unknownOf(briefing.shipped.value?.[0]?.ci)).toContain('403')
    expect(briefing.figures['tickets.shipped']).toMatchObject({ value: 1 })
    expect(unknownOf(briefing.figures['repository.visibility'])).toBe('the repository was not read')
  })

  it('leaves one shipment unknown when its runs cannot be read', async () => {
    const reader = github({ text: async () => { throw new Error('log answered 500') } })
    const ci = await readCi(reader, GIT, [{ commit: SHIPPED, base: BASE }], 'dev')
    const briefing = buildBriefing(inputs(), ci)
    expect(briefing.shipped.value?.[0]?.ci).toMatchObject({ value: null, unknown: 'log answered 500' })
    expect(briefing.figures['ci.completed']).toMatchObject({ value: 4 })
  })

  it('finds no carrying run for a commit no run contains', async () => {
    const ci = await readCi(github(), ancestry([]), [{ commit: SHIPPED, base: null }], 'dev')
    const verdict = ci.shipments.get(SHIPPED)
    expect(verdict).toMatchObject({ carrying: null, base: null, firstGreen: null, introduced: [], preExisting: [] })
  })
})

describe('the briefing', () => {
  const ci = async (): Promise<CiReading> => readCi(github(), GIT, [{ commit: SHIPPED, base: BASE }], 'dev')

  it('computes each figure with its source and states the newest input as its moment', async () => {
    const briefing = buildBriefing(inputs(), await ci())
    expect(briefing.schema).toBe(BRIEFING_SCHEMA)
    expect(briefing.asOf).toBe('2026-09-28T20:11:51.582Z')
    expect(briefing.figures['seats.defined']?.value).toBe(4)
    expect(briefing.figures['seats.defined']?.source.paths).toEqual(['data/enterprise/roster.json'])
    expect(briefing.figures['tickets.open']?.value).toBe(1)
    expect(briefing.figures['tickets.shipped']?.value).toBe(1)
    expect(briefing.figures['pilot.cycles']?.value).toBe(1)
    expect(briefing.figures['pilot.schedulerCycles']?.value).toBe(0)
    expect(briefing.figures['pilot.operatorShipped']?.value).toBe(1)
    expect(briefing.figures['pilot.schedulerShipped']?.value).toBe(0)
    expect(briefing.figures['ci.exactShipped']?.value).toBe(0)
    expect(briefing.figures['repository.visibility']).toMatchObject({ value: 'public', source: { urls: ['https://github.com/LBJLincoln/deepseek-harness'] } })
    expect(briefing.pilot.value?.map(row => [row.id, row.startedBy])).toEqual([['182951-78a6', 'operator'], ['cycle-20260928T201148Z', 'operator']])
    expect(briefing.figures['bench.environments']?.value).toBe(2)
    expect(briefing.figures['bench.domains']?.value).toBe(2)
    expect(briefing.figures['bench.hardestTier']?.value).toBe(6)
    expect(briefing.figures['economics.tokensPerShipped']?.value).toBe(1_000_000)
    expect(briefing.figures['economics.shiftSeconds']?.value).toBe(2076)
    expect(unknownOf(briefing.figures['economics.currency'])).toContain('tokens and seconds')
    expect(briefing.figures['ci.success']?.value).toBe(1)
    expect(briefing.figures['ci.cancelled']?.value).toBe(1)
    expect(briefing.routes.value).toEqual([{ route: 'claude-code', sessions: 9 }, { route: 'openrouter', sessions: 1 }])
    expect(briefing.shipped.value?.[0]).toMatchObject({ ticket: 'T-0012', title: 'Drop an export', seatName: 'Harness Core Llm Steward', base: BASE, checks: { passed: 2, total: 2 }, review: 'approve', reviewToolCalls: 0, tokens: 1_000_000 })
  })

  it('marks a figure unknown when its input is absent rather than estimating it', async () => {
    const line = ticketLine({})
    delete line.tokens
    delete line.seconds
    const briefing = buildBriefing(inputs({ ledger: { lines: [line], skipped: [] } }), await ci())
    expect(unknownOf(briefing.figures['economics.tokensPerShipped'])).toBe('no shipped ticket line records tokens')
    expect(briefing.safety.tiers).toMatchObject({ value: null })
    expect(briefing.safety.seeded).toMatchObject({ value: null })
  })

  it('serializes identically over identical inputs', async () => {
    expect(serializeBriefing(buildBriefing(inputs(), await ci()))).toBe(serializeBriefing(buildBriefing(inputs(), await ci())))
  })

  it('renders both sides of the summary from the same figures with the same structure', async () => {
    const briefing = buildBriefing(inputs(), await ci())
    const en = renderSummary(briefing, 'en')
    const zh = renderSummary(briefing, 'zh')
    const shape = (text: string) => text.split('\n').map(line => (line.startsWith('#') ? line.split(' ')[0] : line.startsWith('|') ? '|' : line.startsWith('- ') ? '-' : '')).join('')
    expect(shape(en)).toBe(shape(zh))
    expect(en).toContain('| Tickets shipped: by units the operator started / by cycles the scheduler started | 1 / 0 |')
    expect(zh).toContain('| 已交付工单：操作员启动的单元 / 调度器启动的周期 | 1 / 0 |')
    expect(en).toContain('| shift `182951-78a6` | 28 September 2026, 18:29 UTC | operator | 1 | 1 (T-0012) | 0 | 0 | exact commit: 0 of 1 run; containing run: failed | 1,000,000 |')
    expect(en).toContain('No Branch CI run tested any of these exact commits. The containing run of the push that carried them failed: the push introduced a failure of `translation pairing`')
    for (const text of [en, zh]) {
      for (const phrase of ['unattended cycles ship', 'CI-verified', 'never leaves', '(human)']) expect(text).not.toContain(phrase)
    }
    const unknownCi = buildBriefing(inputs(), { runs: [], shipments: new Map(), failure: 'offline' })
    expect(renderSummary(unknownCi, 'en')).toContain('unknown (Branch CI could not be read: offline)')
  })
})

describe('files', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('rewrites a file only when its bytes change, and reports a summary that differs from the rendering', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'briefing-'))
    dirs.push(dir)
    expect(writeIfChanged(join(dir, 'a/b.json'), 'x\n')).toBe(true)
    expect(writeIfChanged(join(dir, 'a/b.json'), 'x\n')).toBe(false)
    expect(readFileSync(join(dir, 'a/b.json'), 'utf8')).toBe('x\n')
    const briefing = buildBriefing(inputs(), await readCi(github(), GIT, [], 'dev'))
    expect(checkSummary(dir, briefing)).toEqual(['docs/client/daliesk-executive-summary.md', 'docs/client/daliesk-executive-summary.zh.md'])
  })

  it('groups the digests of the files read by input set', () => {
    const book = new DigestBook()
    book.add('data/enterprise/roster.json', '{}')
    book.add('data/enterprise/tickets/T-0001.json', 'a')
    book.add('data/enterprise/tickets/T-0002.json', 'b')
    const digests = book.summarize()
    expect(digests.map(digest => [digest.path, digest.files, digest.bytes])).toEqual([['data/enterprise/roster.json', 1, 2], ['data/enterprise/tickets', 2, 2]])
    expect(digests[0]?.sha256).toBe('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a')
  })
})
