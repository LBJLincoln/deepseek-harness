/**
 * The pure half of the enterprise shift: ticket selection from the ledger, the
 * standard a ticket compiles to, the reviewer's verdict line, the shipped
 * commit message, and the redaction every recorded byte passes through.
 */

import { describe, expect, it } from 'vitest'
import type { CheckId } from '@deepseek-ai/dsh-verification/types'
import { HARNESS_QUEUE_POLICY, OPEN_QUEUE_POLICY } from '../../../scripts/enterprise-tickets.ts'
import {
  departmentKey,
  documentationCheck,
  ENGINE_CHECKS,
  LIMIT_HALT_REASON,
  parseLedger,
  queueOrder,
  readReviewVerdict,
  redactCredentials,
  selectTickets,
  shiftIdFor,
  shiftRecordName,
  shippedCommitMessage,
  ticketChecks,
  ticketStatuses,
} from './fixtures/enterprise-shift/shift.ts'
import type { Ticket, TicketLedgerLine } from './fixtures/enterprise-shift/shift.ts'

function ticket(id: string, priority: number, division = 'harness-core'): Ticket {
  return {
    id,
    title: `Ticket ${id}`,
    division,
    seat: 'seed-tools-steward',
    kind: 'chore',
    source: { path: 'tools/README.md', anchor: 'tools' },
    task: 'tools/README.md:1 states the task.',
    scope: ['tools/', 'tooling/extra.mjs'],
    acceptance: [{ id: 'runs', run: 'node tools/x.mjs' }],
    budget: { maxTotalTokens: 1000, maxWallMs: 1000 },
    priority,
  }
}

function line(ticketId: string, shipped: string | null, verdict: 'approve' | 'reject' | 'none', at = '2026-09-28T00:00:00.000Z'): TicketLedgerLine {
  return {
    type: 'ticket',
    at,
    shift: 'shift-1',
    ticket: ticketId,
    seat: 'seed-tools-steward',
    division: 'harness-core',
    programId: 'program-abc',
    implementer: 'route',
    model: 'cli-mock',
    department: { outcome: 'certified', sessionId: 'program-abc-t-0001' },
    checks: [{ id: 'runs', ok: true }],
    review: { verdict, sessionId: verdict === 'none' ? null : 'review-1' },
    integration: { outcome: shipped === null ? 'not-shipped' : 'merged' },
    shipped: shipped === null ? null : { commit: shipped },
    reason: '',
    tokens: 1,
    seconds: 1,
  }
}

describe('ticket status from the ledger', () => {
  it('reads each ticket from its latest line: shipped, rejected, or open', () => {
    const lines = [line('T-0001', null, 'none'), line('T-0001', 'a'.repeat(40), 'approve'), line('T-0002', null, 'reject'), line('T-0003', null, 'none')]
    expect([...ticketStatuses(lines).entries()]).toEqual([['T-0001', 'shipped'], ['T-0002', 'rejected'], ['T-0003', 'open']])
  })

  it('reads ticket lines, counts a line without a type as one, and skips the functions\' lines in the same file', () => {
    const functionLine = { type: 'function', at: '2026-09-28T00:00:00.000Z', shift: 'shift-1', seat: 's', division: 'd', function: 'f', target: 't', outcome: 'ok', evidence: 'e', seconds: 1 }
    const untyped = { ...line('T-0002', 'b'.repeat(40), 'approve'), type: undefined }
    const mixed = `${[line('T-0001', null, 'none'), functionLine, untyped].map(entry => JSON.stringify(entry)).join('\n')}\n`
    expect(parseLedger(mixed).map(entry => entry.ticket)).toEqual(['T-0001', 'T-0002'])
    expect([...ticketStatuses(parseLedger(mixed)).entries()]).toEqual([['T-0001', 'open'], ['T-0002', 'shipped']])
    expect(parseLedger('')).toEqual([])
    expect(() => parseLedger('not json\n')).toThrow()
  })
})

describe('ticket selection', () => {
  const queue = [ticket('T-0001', 2), ticket('T-0002', 1), ticket('T-0003', 1), ticket('T-0004', 3)]

  it('takes the next open tickets by priority, then id', () => {
    const ledger = [line('T-0002', 'b'.repeat(40), 'approve')]
    expect(selectTickets(queue, ledger, { kind: 'next', count: 2 }).map(entry => entry.id)).toEqual(['T-0003', 'T-0001'])
    expect(selectTickets(queue, ledger, { kind: 'next', count: 9 }).map(entry => entry.id)).toEqual(['T-0003', 'T-0001', 'T-0004'])
    expect(() => selectTickets(queue, ledger, { kind: 'next', count: 0 })).toThrow(/positive integer/)
  })

  it('puts a ticket an earlier shift attempted behind every untried one, whatever its priority', () => {
    const failed = { ...line('T-0003', null, 'none'), reason: 'the department failed' }
    expect(queueOrder(queue, [failed]).map(entry => entry.id)).toEqual(['T-0002', 'T-0001', 'T-0004', 'T-0003'])
    const twice = { ...line('T-0002', null, 'none'), reason: 'checks failed' }
    expect(queueOrder(queue, [failed, twice, twice]).map(entry => entry.id)).toEqual(['T-0001', 'T-0004', 'T-0003', 'T-0002'])
  })

  it('does not count a halt on the usage limit as an attempt', () => {
    const halted = { ...line('T-0003', null, 'none'), reason: `${LIMIT_HALT_REASON} (resets at 2026-09-29T02:00:00Z; limit)` }
    expect(queueOrder(queue, [halted, halted]).map(entry => entry.id)).toEqual(['T-0002', 'T-0003', 'T-0001', 'T-0004'])
  })

  it('gives each division its turn among tickets of the same priority', () => {
    const mixed = [
      ticket('T-0001', 1),
      ticket('T-0002', 1),
      ticket('T-0003', 1),
      ticket('T-0004', 1, 'knowledge'),
      ticket('T-0005', 1, 'governance'),
      ticket('T-0006', 2, 'knowledge'),
      ticket('T-0007', 1, 'knowledge'),
    ]
    expect(queueOrder(mixed, []).map(entry => entry.id)).toEqual(['T-0001', 'T-0004', 'T-0005', 'T-0002', 'T-0007', 'T-0003', 'T-0006'])
    expect(selectTickets(mixed, [], { kind: 'next', count: 3 }).map(entry => entry.id)).toEqual(['T-0001', 'T-0004', 'T-0005'])
  })

  it('takes named tickets in the order named and refuses an unknown or closed one', () => {
    expect(selectTickets(queue, [], { kind: 'tickets', ids: ['T-0004', 'T-0001'] }).map(entry => entry.id)).toEqual(['T-0004', 'T-0001'])
    expect(() => selectTickets(queue, [], { kind: 'tickets', ids: ['T-0009'] })).toThrow(/T-0009 is not in the queue/)
    expect(() => selectTickets(queue, [line('T-0001', null, 'reject')], { kind: 'tickets', ids: ['T-0001'] })).toThrow(/T-0001 is rejected/)
  })
})

describe('the standard a ticket compiles to', () => {
  it('runs the acceptance, then requires a commit, the scope, and a clean diff', () => {
    const checks = ticketChecks(ticket('T-0007', 1), 'abc123', OPEN_QUEUE_POLICY)
    expect(checks.map(check => check.id)).toEqual(['runs', ENGINE_CHECKS.committed, ENGINE_CHECKS.scope, ENGINE_CHECKS.whitespace])
    expect(checks[1]?.run).toBe('test "$(git rev-parse HEAD)" != "$(git rev-parse abc123)"')
    expect(checks[2]?.run).toBe('test -z "$(git diff --name-only abc123 HEAD -- . \':(exclude)tools/\' \':(exclude)tooling/extra.mjs\')"')
    expect(checks[3]?.run).toBe('git diff --check abc123 HEAD')
    expect(ticketChecks(ticket('T-0007', 1), 'abc123', OPEN_QUEUE_POLICY, 'merged-').map(check => check.id)[0]).toBe('merged-runs')
    expect(departmentKey('T-0007')).toBe('t-0007')
  })

  it('carries the queue\'s documentation gate over a change that touches a Markdown document', () => {
    const checks = ticketChecks(ticket('T-0007', 1), 'abc123', HARNESS_QUEUE_POLICY)
    expect(checks.at(-1)?.id).toBe(ENGINE_CHECKS.documentation)
    expect(checks.at(-1)?.run).toBe("! git diff --name-only abc123 HEAD -- '*.md' | grep -q . || pnpm run verify-translation-pairing")
    expect(documentationCheck(OPEN_QUEUE_POLICY, 'abc123', 'x' as CheckId)).toEqual([])
  })
})

describe('the reviewer verdict', () => {
  it('reads the first verdict line and keeps the rest as the rationale', () => {
    expect(readReviewVerdict('verdict: approve\nThe diff matches.\n', 100)).toEqual({ verdict: 'approve', rationale: 'The diff matches.' })
    expect(readReviewVerdict('Some preamble\nVerdict: reject\nToo wide.', 100)).toEqual({ verdict: 'reject', rationale: 'Too wide.' })
    expect(readReviewVerdict('verdict: approve', 100)).toEqual({ verdict: 'approve', rationale: 'the reviewer gave no reason' })
  })

  it('rejects an answer that names no verdict, carrying the answer', () => {
    expect(readReviewVerdict('looks fine to me', 100)).toEqual({ verdict: 'reject', rationale: 'no verdict line: looks fine to me' })
    expect(readReviewVerdict('', 100)).toEqual({ verdict: 'reject', rationale: 'the reviewer answered nothing' })
    expect(readReviewVerdict(`verdict: reject\n${'x'.repeat(50)}`, 10).rationale).toBe(`${'x'.repeat(9)}…`)
  })
})

describe('the shipped commit message', () => {
  it('names the shift, the ticket, the seat, the program, both sessions, and ends with the trailers', () => {
    const message = shippedCommitMessage(ticket('T-0001', 1), '184501-ab12', 'program-abc', 'program-abc-t-0001', 'review-t-0001-1', {
      coAuthor: 'Claude Code sonnet <noreply@anthropic.com>',
      session: 'https://claude.ai/code/session_x',
    })
    expect(message.split('\n')).toEqual([
      'T-0001: Ticket T-0001',
      '',
      'Shift: Daliesk shift 184501-ab12',
      'Seat: seed-tools-steward (harness-core)',
      'Program: program-abc',
      'Department session: program-abc-t-0001',
      'Review session: review-t-0001-1',
      'Source: tools/README.md — tools',
      '',
      'Co-Authored-By: Claude Code sonnet <noreply@anthropic.com>',
      'Claude-Session: https://claude.ai/code/session_x',
    ])
  })
})

describe('the record', () => {
  it('cuts credential-shaped strings and counts them', () => {
    const { text, redacted } = redactCredentials('token sk-abcdefghijklmnop and AKIAABCDEFGHIJKLMNOP plus ghp_abcdefghijklmnopqrstuvwxyz1234 and plain words')
    expect(text).toBe('token [redacted] and [redacted] plus [redacted] and plain words')
    expect(redacted).toBe(3)
    expect(redactCredentials('nothing here').redacted).toBe(0)
  })

  it('names the shift by its UTC start', () => {
    const startedAt = new Date('2026-09-28T18:45:01.500Z')
    expect(shiftIdFor(startedAt, 'ab12')).toBe('184501-ab12')
    expect(shiftRecordName(startedAt, '184501-ab12')).toBe('2026-09-28-184501-ab12')
  })
})
