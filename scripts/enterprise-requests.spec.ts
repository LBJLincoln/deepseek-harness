import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { queueOrder } from '../examples/headless-agent/tests/fixtures/enterprise-shift/shift.ts'
import type { Ticket as ShiftTicket, TicketLedgerLine } from '../examples/headless-agent/tests/fixtures/enterprise-shift/shift.ts'
import type { TicketLine } from './enterprise-ledger.ts'
import {
  answeringTickets,
  formatStatus,
  isTitled,
  parseRequestsCommand,
  readIntakeRequests,
  readRequests,
  readRequestStatuses,
  requestStatuses,
  requestTitle,
  unansweredRequests,
} from './enterprise-requests.ts'
import type { IntakeRecordRequests, Request, RequestStatus } from './enterprise-requests.ts'
import { REQUESTS_DIR } from './enterprise-tickets.ts'

const repoRoot = resolve(import.meta.dirname, '..')
const roots: string[] = []

afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A temporary tree holding exactly the files named, relative to its root. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'enterprise-requests-'))
  roots.push(root)
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

function request(name: string, title: string | null = name): Request {
  const anchor = title === null ? null : `# ${title}`
  return { path: `${REQUESTS_DIR}/${name}.md`, title, anchor, text: `${anchor ?? 'no title'}\n` }
}

function ticketLine(ticket: string, fields: Partial<TicketLine> = {}): TicketLine {
  return { type: 'ticket', at: '2026-09-29T02:00:00.000Z', shift: 's', ticket, seat: 'seat', division: 'division', checks: [], shipped: null, ...fields }
}

describe('a request file', () => {
  it.each([
    ['# Show the deck in dark mode\n\nThe deck is too bright.\n', 'Show the deck in dark mode', '# Show the deck in dark mode'],
    ['﻿\n\r\n#  Bound the drain  \r\nWhy.\r\n', 'Bound the drain', '#  Bound the drain'],
    ['# Only a title', 'Only a title', '# Only a title'],
  ])('reads its title from its first non-blank line: %j', (text, title, anchor) => {
    expect(requestTitle(text)).toEqual({ title, anchor })
  })

  it.each([
    ['', 'an empty file'],
    ['Please add a dark mode.\n# Dark mode\n', 'a first line that is not a heading'],
    ['## Dark mode\n', 'a second-level heading'],
    ['#Dark mode\n', 'no space after the hash'],
    ['#   \n', 'an empty title'],
  ])('has no title with %j (%s)', (text) => {
    expect(requestTitle(text)).toEqual({ title: null, anchor: null })
  })

  it('is every Markdown file directly under the requests directory but its README pair, in file-name order', () => {
    const root = tree({
      [`${REQUESTS_DIR}/README.md`]: '# Requests\n',
      [`${REQUESTS_DIR}/README.zh.md`]: '# 请求\n',
      [`${REQUESTS_DIR}/README.i18n.yaml`]: 'README.md: x\n',
      [`${REQUESTS_DIR}/b-bound.md`]: '# Bound the drain\n\nIt never stops.\n',
      [`${REQUESTS_DIR}/a dark mode.md`]: '# Dark mode\n',
      [`${REQUESTS_DIR}/c-untitled.md`]: 'Make it faster.\n',
      [`${REQUESTS_DIR}/notes.txt`]: '# Not a request\n',
      [`${REQUESTS_DIR}/archive/old.md`]: '# Old\n',
    })
    expect(readRequests(root)).toEqual([
      { path: `${REQUESTS_DIR}/a dark mode.md`, title: 'Dark mode', anchor: '# Dark mode', text: '# Dark mode\n' },
      { path: `${REQUESTS_DIR}/b-bound.md`, title: 'Bound the drain', anchor: '# Bound the drain', text: '# Bound the drain\n\nIt never stops.\n' },
      { path: `${REQUESTS_DIR}/c-untitled.md`, title: null, anchor: null, text: 'Make it faster.\n' },
    ])
    expect(readRequests(root).map(isTitled)).toEqual([true, true, false])
    expect(readRequests(tree({}))).toEqual([])
  })
})

describe('the answered check', () => {
  it('reads a request as answered by every ticket whose source path is its file, whatever the anchor or status', () => {
    const [dark, bound, other] = [request('dark'), request('bound'), request('other')]
    const tickets = [
      { id: 'T-0001', source: { path: dark.path } },
      { id: 'T-0002', source: { path: 'packages/alpha/README.md' } },
      { id: 'T-0003', source: { path: bound.path } },
      { id: 'T-0004', source: { path: dark.path } },
    ]
    expect(answeringTickets(dark, tickets).map(ticket => ticket.id)).toEqual(['T-0001', 'T-0004'])
    expect(unansweredRequests([bound, dark, other], tickets)).toEqual([other])
    expect(unansweredRequests([bound, other], [])).toEqual([bound, other])
  })
})

describe('the status of a request', () => {
  const refusedFirst: IntakeRecordRequests = {
    record: 'data/enterprise/intake/2026-09-29-010000-aaaa',
    at: '2026-09-29T01:00:00.000Z',
    requests: [
      { path: request('refused').path, result: 'refused', reason: 'the first reason' },
      { path: request('reached-once').path, result: 'refused', reason: 'an old reason' },
      { path: request('queued').path, result: 'refused', reason: 'refused before its ticket was filed' },
    ],
  }
  const refusedAgain: IntakeRecordRequests = {
    record: 'data/enterprise/intake/2026-09-29-030000-bbbb',
    at: '2026-09-29T03:00:00.000Z',
    requests: [
      { path: request('refused').path, result: 'refused', reason: 'the second reason' },
      { path: request('reached-once').path, result: 'unanswered' },
    ],
  }

  it('derives each of the six states from the queue, the ticket lines and the intake records', () => {
    const requests = ['waiting', 'refused', 'reached-once', 'queued', 'halted', 'shipped', 'rejected'].map(name => request(name))
    const tickets = ['queued', 'halted', 'shipped', 'rejected'].map((name, index) => ({ id: `T-000${index + 1}`, source: { path: request(name).path } }))
    const lines = [
      ticketLine('T-0002', { reason: 'departments: failed' }),
      ticketLine('T-0003', { reason: 'departments: failed' }),
      ticketLine('T-0003', { shipped: { commit: 'c'.repeat(40) }, review: { verdict: 'approve' } }),
      ticketLine('T-0004', { review: { verdict: 'reject' }, reason: 'review: rejected' }),
    ]
    expect(requestStatuses(requests, tickets, lines, [refusedFirst, refusedAgain])).toEqual([
      { file: request('waiting').path, title: 'waiting', state: 'waiting' },
      { file: request('refused').path, title: 'refused', state: 'refused', reason: 'the second reason', intake: refusedAgain.record },
      { file: request('reached-once').path, title: 'reached-once', state: 'waiting' },
      { file: request('queued').path, title: 'queued', state: 'queued', ticket: 'T-0001' },
      { file: request('halted').path, title: 'halted', state: 'halted', ticket: 'T-0002', reason: 'departments: failed' },
      { file: request('shipped').path, title: 'shipped', state: 'shipped', ticket: 'T-0003', commit: 'c'.repeat(40) },
      { file: request('rejected').path, title: 'rejected', state: 'rejected', ticket: 'T-0004', reason: 'review: rejected' },
    ] satisfies RequestStatus[])
  })

  it('reads the newest answering ticket when several answer one request', () => {
    const tickets = [{ id: 'T-0001', source: { path: request('twice').path } }, { id: 'T-0002', source: { path: request('twice').path } }]
    const lines = [ticketLine('T-0001', { review: { verdict: 'reject' } })]
    expect(requestStatuses([request('twice')], tickets, lines, []).map(status => [status.state, status.ticket])).toEqual([['queued', 'T-0002']])
  })

  it('reads the committed files of a repository, passing over a torn record and a malformed entry', () => {
    const ledger = [
      ticketLine('T-0001', { shipped: { commit: 'abc1234' } }),
      { type: 'function', at: '2026-09-29T02:00:00.000Z', shift: 's', seat: 'seat', division: 'division', function: 'intake', target: { commit: 'x' }, outcome: 'pass', evidence: { path: 'p' }, seconds: 1 },
    ]
    const root = tree({
      [`${REQUESTS_DIR}/README.md`]: '# Requests\n',
      [`${REQUESTS_DIR}/a-shipped.md`]: '# Ship it\n',
      [`${REQUESTS_DIR}/b-refused.md`]: '# Refuse it\n',
      [`${REQUESTS_DIR}/c-untitled.md`]: 'No title here.\n',
      'data/enterprise/tickets/T-0001.json': JSON.stringify({ id: 'T-0001', source: { path: `${REQUESTS_DIR}/a-shipped.md`, anchor: '# Ship it' } }),
      'data/enterprise/tickets/T-0002.json': '{ not json',
      'data/enterprise/ledger.jsonl': `${ledger.map(line => JSON.stringify(line)).join('\n')}\n`,
      'data/enterprise/intake/2026-09-29-010000-aaaa/result.json': JSON.stringify({
        at: '2026-09-29T01:00:00.000Z',
        requests: [
          { path: `${REQUESTS_DIR}/b-refused.md`, result: 'refused', reason: 'seat x does not own the scope' },
          { path: `${REQUESTS_DIR}/c-untitled.md`, result: 'refused', reason: 'its first line is not `# <title>`' },
          { path: `${REQUESTS_DIR}/c-untitled.md`, result: 'refused' },
          { result: 'admitted' },
        ],
      }),
      'data/enterprise/intake/2026-09-29-020000-bbbb/result.json': '{ torn',
      'data/enterprise/intake/2026-09-29-030000-cccc/result.json': JSON.stringify({ at: '2026-09-29T03:00:00.000Z', outcome: 'nothing-needed' }),
    })
    expect(readIntakeRequests(root).map(record => [record.record, record.requests.length])).toEqual([
      ['data/enterprise/intake/2026-09-29-010000-aaaa', 2],
      ['data/enterprise/intake/2026-09-29-030000-cccc', 0],
    ])
    expect(readRequestStatuses(root)).toEqual([
      { file: `${REQUESTS_DIR}/a-shipped.md`, title: 'Ship it', state: 'shipped', ticket: 'T-0001', commit: 'abc1234' },
      {
        file: `${REQUESTS_DIR}/b-refused.md`,
        title: 'Refuse it',
        state: 'refused',
        reason: 'seat x does not own the scope',
        intake: 'data/enterprise/intake/2026-09-29-010000-aaaa',
      },
      {
        file: `${REQUESTS_DIR}/c-untitled.md`,
        title: null,
        state: 'refused',
        reason: 'its first line is not `# <title>`',
        intake: 'data/enterprise/intake/2026-09-29-010000-aaaa',
      },
    ])
    expect(readRequestStatuses(tree({}))).toEqual([])
  })
})

describe('pnpm run enterprise:requests', () => {
  it('prints one line per request: the state, the file, the title and what the state rests on', () => {
    expect([
      { file: `${REQUESTS_DIR}/a.md`, title: 'Dark mode', state: 'waiting' },
      { file: `${REQUESTS_DIR}/b.md`, title: null, state: 'refused', reason: 'its first line is not `# <title>`', intake: 'data/enterprise/intake/x' },
      { file: `${REQUESTS_DIR}/c.md`, title: 'Cap', state: 'queued', ticket: 'T-0042' },
      { file: `${REQUESTS_DIR}/d.md`, title: 'Cap', state: 'halted', ticket: 'T-0043', reason: 'departments: failed' },
      { file: `${REQUESTS_DIR}/e.md`, title: 'Cap', state: 'shipped', ticket: 'T-0044', commit: 'abc1234' },
      { file: `${REQUESTS_DIR}/f.md`, title: 'Cap', state: 'rejected', ticket: 'T-0045' },
    ].map(status => formatStatus(status as RequestStatus))).toEqual([
      `waiting   ${REQUESTS_DIR}/a.md  "Dark mode"`,
      `refused   ${REQUESTS_DIR}/b.md  (no title line)  data/enterprise/intake/x: its first line is not \`# <title>\``,
      `queued    ${REQUESTS_DIR}/c.md  "Cap"  T-0042`,
      `halted    ${REQUESTS_DIR}/d.md  "Cap"  T-0043: departments: failed`,
      `shipped   ${REQUESTS_DIR}/e.md  "Cap"  T-0044 in commit abc1234`,
      `rejected  ${REQUESTS_DIR}/f.md  "Cap"  T-0045`,
    ])
  })

  it('reads its options, dropping pnpm\'s own separator', () => {
    expect(parseRequestsCommand(['--', '--json', '--root', '/repo'])).toEqual({ kind: 'status', json: true, root: '/repo' })
    expect(parseRequestsCommand([])).toEqual({ kind: 'status', json: false, root: repoRoot })
    expect(parseRequestsCommand(['--help'])).toEqual({ kind: 'help' })
    expect(() => parseRequestsCommand(['--state', 'waiting'])).toThrow(/Unknown option/)
  })

  it('prints the same statuses as JSON under --json', () => {
    const root = tree({ [`${REQUESTS_DIR}/a.md`]: '# Dark mode\n' })
    const run = (...args: string[]) => spawnSync(join(repoRoot, 'node_modules/.bin/tsx'), [join(repoRoot, 'scripts/enterprise-requests.ts'), '--root', root, ...args], { encoding: 'utf8' })
    const json = run('--json')
    expect([json.status, json.stderr]).toEqual([0, ''])
    expect(JSON.parse(json.stdout)).toEqual([{ file: `${REQUESTS_DIR}/a.md`, title: 'Dark mode', state: 'waiting' }])
    expect(run().stdout).toBe(`waiting   ${REQUESTS_DIR}/a.md  "Dark mode"\n`)
  })
})

describe('the shift takes a ticket answering a request first', () => {
  function shiftTicket(id: string, priority: number, division: string): ShiftTicket {
    const source = priority === 0 ? { path: `${REQUESTS_DIR}/${id}.md`, anchor: `# ${id}` } : { path: 'packages/alpha/README.md', anchor: id }
    return { id, title: id, division, seat: `${division}-seat`, kind: 'fix', source, task: '', scope: [], acceptance: [], budget: { maxTotalTokens: 1, maxWallMs: 1 }, priority }
  }

  function attempt(ticket: string, reason: string): TicketLedgerLine {
    return {
      type: 'ticket',
      at: '2026-09-29T02:00:00.000Z',
      shift: 's',
      ticket,
      seat: 'seat',
      division: 'division',
      programId: 'p',
      implementer: 'route',
      model: 'm',
      department: { outcome: 'failed', sessionId: null },
      checks: [],
      review: { verdict: 'none', sessionId: null },
      integration: { outcome: 'not-shipped' },
      shipped: null,
      reason,
      tokens: 0,
      seconds: 0,
    }
  }

  const queue = [
    shiftTicket('T-0001', 1, 'harness-core'),
    shiftTicket('T-0002', 1, 'knowledge'),
    shiftTicket('T-0003', 2, 'harness-core'),
    shiftTicket('T-0004', 0, 'governance'),
    shiftTicket('T-0005', 0, 'harness-core'),
    shiftTicket('T-0006', 1, 'harness-core'),
  ]

  it('before every untried ticket, whatever its division\'s turn, in the engine\'s own queue order', () => {
    const order = queueOrder(queue, [attempt('T-0006', 'departments: failed')]).map(ticket => ticket.id)
    expect(order).toEqual(['T-0004', 'T-0005', 'T-0001', 'T-0002', 'T-0003', 'T-0006'])
  })

  it('after every untried ticket once it has been tried, and a usage-limit halt is no attempt', () => {
    expect(queueOrder(queue, [attempt('T-0004', 'departments: failed')]).map(ticket => ticket.id))
      .toEqual(['T-0005', 'T-0001', 'T-0002', 'T-0006', 'T-0003', 'T-0004'])
    expect(queueOrder(queue, [attempt('T-0004', 'halted: limit (resets at 2026-09-29T08:00:00.000Z)')]).map(ticket => ticket.id))
      .toEqual(['T-0004', 'T-0005', 'T-0001', 'T-0002', 'T-0006', 'T-0003'])
  })
})
