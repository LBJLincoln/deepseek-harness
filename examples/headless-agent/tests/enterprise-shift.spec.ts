/**
 * The pure half of the enterprise shift: ticket selection from the ledger, the
 * standard a ticket compiles to under the heavy lock and the generated paths,
 * the objective and the ticket the reviewer reads, the reviewer's verdict line,
 * the shipped commit message, the redaction every recorded byte passes
 * through, the tickets the engine refuses to work, and the environment of the
 * commands the engine spawns itself.
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { CheckId } from '@deepseek-ai/dsh-verification/types'
import { HARNESS_QUEUE_POLICY, OPEN_QUEUE_POLICY } from '../../../scripts/enterprise-tickets.ts'
import {
  ABANDONED_REASON,
  abandonedLines,
  ACCEPTANCE_REFUSED_REASON,
  acceptanceRefusals,
  acceptanceRun,
  checkEnvironment,
  departmentKey,
  departmentObjective,
  documentationCheck,
  ENGINE_CHECKS,
  ENGINE_PRINCIPAL_ID,
  engineDecisions,
  heldForTriage,
  LIMIT_HALT_REASON,
  lintCheck,
  parseLedger,
  parseShiftStarts,
  queueOrder,
  readReviewVerdict,
  recordLeaks,
  redactCredentials,
  reviewTicketText,
  selectTickets,
  shiftIdFor,
  shiftRecordName,
  shiftStartMessage,
  shippedCommitMessage,
  ticketChecks,
  ticketScope,
  ticketStatuses,
  TRIAGE_HOLD_REASON,
} from './fixtures/enterprise-shift/shift.ts'
import type { ShiftStartLine, Ticket, TicketLedgerLine } from './fixtures/enterprise-shift/shift.ts'

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

  it('places a line written after the fact by its time, so an older shift recorded late settles nothing a later line settled', () => {
    const late = (entry: TicketLedgerLine): TicketLedgerLine => ({ ...entry, recordedBy: 'supervisor', recordedAt: '2026-09-29T10:00:00.000Z' })
    const shipped = line('T-0001', 'a'.repeat(40), 'approve', '2026-09-28T19:00:00.000Z')
    const halted = line('T-0002', null, 'none', '2026-09-28T22:00:00.000Z')
    const lines = [
      shipped,
      halted,
      late(line('T-0001', null, 'reject', '2026-09-28T18:00:00.000Z')),
      late(line('T-0002', null, 'reject', '2026-09-28T21:00:00.000Z')),
      late(line('T-0003', null, 'none', '2026-09-28T20:00:00.000Z')),
      late(line('T-0002', null, 'reject', '2026-09-28T22:00:00.000Z')),
    ]
    expect([...ticketStatuses(lines).entries()]).toEqual([['T-0001', 'shipped'], ['T-0002', 'rejected'], ['T-0003', 'open']])
    expect([...ticketStatuses(lines.slice(0, 5)).entries()]).toEqual([['T-0001', 'shipped'], ['T-0002', 'open'], ['T-0003', 'open']])
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

describe('a ticket its reviewer rejected', () => {
  const queue = [ticket('T-0001', 1), ticket('T-0002', 1), ticket('T-0003', 1)]
  const reviewer = { sessionId: 'review-t-0001-1', route: 'claude-code', model: 'sonnet', verdict: 'reject' as const }
  const rejected = { ...line('T-0001', null, 'reject'), shift: 'shift-9', review: { verdict: 'reject' as const, sessionId: 'review-t-0001-1' }, reviewer }
  const unrecorded = { ...line('T-0002', null, 'reject'), shift: 'shift-8', review: { verdict: 'reject' as const, sessionId: 'review-t-0002-1' } }

  it('is held for human triage: no shift takes it again, so no model reviews it a second time', () => {
    expect(selectTickets(queue, [rejected, unrecorded], { kind: 'next', count: 3 }).map(entry => entry.id)).toEqual(['T-0003'])
    expect(() => selectTickets(queue, [rejected], { kind: 'tickets', ids: ['T-0001'] })).toThrow(/T-0001 is rejected/)
  })

  it('is held with a reason naming the rejecting shift, the review session and the reviewer, or that the reviewer is not recorded', () => {
    expect(heldForTriage(queue, [unrecorded, rejected, line('T-0003', null, 'none')])).toEqual([
      { ticket: 'T-0001', reason: `${TRIAGE_HOLD_REASON}: review review-t-0001-1 rejected it in shift shift-9 (reviewer sonnet on claude-code); the engine does not review a rejected ticket again` },
      { ticket: 'T-0002', reason: `${TRIAGE_HOLD_REASON}: review review-t-0002-1 rejected it in shift shift-8 (reviewer not recorded); the engine does not review a rejected ticket again` },
    ])
  })

  it('is not held when a later line reopened it', () => {
    expect(heldForTriage(queue, [rejected, { ...line('T-0001', null, 'none'), reason: 'abandoned' }])).toEqual([])
    expect(heldForTriage(queue, [])).toEqual([])
  })
})

describe('the standard a ticket compiles to', () => {
  it('runs the acceptance, then requires a commit, the scope, and a clean diff', () => {
    const checks = ticketChecks(ticket('T-0007', 1), 'abc123', OPEN_QUEUE_POLICY, undefined)
    expect(checks.map(check => check.id)).toEqual(['runs', ENGINE_CHECKS.committed, ENGINE_CHECKS.scope, ENGINE_CHECKS.whitespace])
    expect(checks[1]?.run).toBe('test "$(git rev-parse HEAD)" != "$(git rev-parse abc123)"')
    expect(checks[2]?.run).toBe('test -z "$(git diff --name-only abc123 HEAD -- . \':(exclude)tools/\' \':(exclude)tooling/extra.mjs\')"')
    expect(checks[3]?.run).toBe('git diff --check abc123 HEAD')
    expect(ticketChecks(ticket('T-0007', 1), 'abc123', OPEN_QUEUE_POLICY, undefined, 'merged-').map(check => check.id)[0]).toBe('merged-runs')
    expect(departmentKey('T-0007')).toBe('t-0007')
  })

  it('carries the queue\'s documentation gate over a change that touches a Markdown document', () => {
    const checks = ticketChecks(ticket('T-0007', 1), 'abc123', HARNESS_QUEUE_POLICY, undefined)
    expect(checks.at(-1)?.id).toBe(ENGINE_CHECKS.documentation)
    expect(checks.at(-1)?.run).toBe("! git diff --name-only abc123 HEAD -- '*.md' | grep -q . || pnpm run verify-translation-pairing")
    expect(documentationCheck(OPEN_QUEUE_POLICY, 'abc123', 'x' as CheckId)).toEqual([])
  })

  it('lints every changed TypeScript and ES module file with the queue\'s linter, before the documentation gate', () => {
    const checks = ticketChecks(ticket('T-0007', 1), 'abc123', HARNESS_QUEUE_POLICY, undefined)
    expect(checks.map(check => check.id).slice(-2)).toEqual([ENGINE_CHECKS.lint, ENGINE_CHECKS.documentation])
    expect(checks.at(-2)?.run).toBe("git diff -z --name-only --diff-filter=d abc123 HEAD -- '*.ts' '*.tsx' '*.mjs' | xargs -0 -r node_modules/.bin/tsx scripts/run-oxlint.ts")
    expect(lintCheck(OPEN_QUEUE_POLICY, 'abc123', 'x' as CheckId)).toEqual([])
    expect(departmentObjective(ticket('T-0007', 1), 'Seat', HARNESS_QUEUE_POLICY, undefined)).toContain('`node_modules/.bin/tsx scripts/run-oxlint.ts <files>`')
    expect(departmentObjective(ticket('T-0007', 1), 'Seat', OPEN_QUEUE_POLICY, undefined)).not.toContain('Lint:')
  })

  it('counts the queue\'s generated paths inside every ticket\'s scope, the ticket\'s own first', () => {
    const own = ticket('T-0007', 1)
    expect(ticketScope(own, OPEN_QUEUE_POLICY)).toEqual(['tools/', 'tooling/extra.mjs'])
    const scope = ticketScope({ ...own, scope: ['docs/subsystems/', 'tools/'] }, HARNESS_QUEUE_POLICY)
    expect(scope.slice(0, 2)).toEqual(['docs/subsystems/', 'tools/'])
    expect(scope.filter(entry => entry === 'docs/subsystems/')).toHaveLength(1)
    expect(scope).toEqual(expect.arrayContaining(['packages/extensions/tool-cordis/src/api-catalog.ts', 'docs/event-producer-consumer.*']))
    const check = ticketChecks(own, 'abc123', HARNESS_QUEUE_POLICY, undefined).find(entry => entry.id === ENGINE_CHECKS.scope)
    expect(check?.run).toContain("':(exclude)tools/' ':(exclude)tooling/extra.mjs' ':(exclude)docs/subsystems/'")
    expect(check?.run).toContain("':(exclude)docs/event-producer-consumer.*'")
  })

  it('runs a heavy acceptance command under the shift\'s heavy lock, and every other command as written', () => {
    const heavy = { ...ticket('T-0007', 1), acceptance: [
      { id: 'greps', run: "! grep -q 'x' a.ts" },
      { id: 'coverage', run: "pnpm exec vitest run pkg/ --coverage --coverage.include='pkg/src/**/*.ts'" },
      { id: 'typecheck', run: 'pnpm run typecheck' },
      { id: 'doc-sync', run: 'pnpm run doc-sync' },
    ] }
    const runs = ticketChecks(heavy, 'abc123', HARNESS_QUEUE_POLICY, '/tmp/dsh-heavy.lock').slice(0, 4).map(check => check.run)
    expect(runs).toEqual([
      "! grep -q 'x' a.ts",
      String.raw`flock '/tmp/dsh-heavy.lock' bash -c 'pnpm exec vitest run pkg/ --coverage --coverage.include='\''pkg/src/**/*.ts'\'''`,
      "flock '/tmp/dsh-heavy.lock' bash -c 'pnpm run typecheck'",
      "flock '/tmp/dsh-heavy.lock' bash -c 'pnpm run doc-sync'",
    ])
    expect(acceptanceRun('pnpm run doc-sync', HARNESS_QUEUE_POLICY, undefined)).toBe('pnpm run doc-sync')
    expect(acceptanceRun('sh checks/coverage.sh --coverage', OPEN_QUEUE_POLICY, '/tmp/l')).toBe("flock '/tmp/l' bash -c 'sh checks/coverage.sh --coverage'")
  })
})

describe('what the department and the reviewer read', () => {
  it('states the generated paths and how to regenerate them, and the heavy lock when the shift names one', () => {
    const objective = departmentObjective(ticket('T-0007', 1), 'Tools Steward', HARNESS_QUEUE_POLICY, '/tmp/dsh-heavy.lock')
    expect(objective).toContain('Change only paths under: `tools/`, `tooling/extra.mjs`, and the generated files named below.')
    expect(objective).toContain('run the generator it names (`pnpm run gen-…`) and commit what it writes')
    expect(objective).toContain('`pnpm run verify-translation-pairing --write <English path>`')
    expect(objective).toContain('These files are inside your scope whichever package they are in: `docs/subsystems/`, `docs/cordis-api/`')
    expect(objective).toContain('under `flock /tmp/dsh-heavy.lock`')
    expect(objective).toContain('`flock /tmp/dsh-heavy.lock <command>`')
    const plain = departmentObjective(ticket('T-0007', 1), 'Tools Steward', OPEN_QUEUE_POLICY, undefined)
    expect(plain).toContain('Change only paths under: `tools/`, `tooling/extra.mjs`. Install or update no dependencies.')
    expect(plain).not.toContain('Generated files')
    expect(plain).not.toContain('flock')
  })

  it('shows the reviewer the generated paths beside the ticket\'s scope', () => {
    expect(reviewTicketText(ticket('T-0007', 1), HARNESS_QUEUE_POLICY).split('\n')).toContain(`generated: ${HARNESS_QUEUE_POLICY.generatedPaths.join(', ')}`)
    expect(reviewTicketText(ticket('T-0007', 1), OPEN_QUEUE_POLICY)).not.toContain('generated:')
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
  it('names the shift, the ticket, the seat, the program, both sessions, the reviewer\'s model and route, and ends with the trailers', () => {
    const reviewer = { sessionId: 'review-t-0001-1', route: 'claude-code', model: 'opus' }
    const message = shippedCommitMessage(ticket('T-0001', 1), '184501-ab12', 'program-abc', 'program-abc-t-0001', reviewer, {
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
      'Reviewer: opus on claude-code',
      'Source: tools/README.md — tools',
      '',
      'Co-Authored-By: Claude Code sonnet <noreply@anthropic.com>',
      'Claude-Session: https://claude.ai/code/session_x',
    ])
  })
})

describe('shifts that started and never ended', () => {
  const start = (shift: string, tickets: string[], host = 'gone-host'): ShiftStartLine => ({
    type: 'shift-start', at: '2026-09-28T20:00:00.000Z', shift, tickets, base: 'b'.repeat(40), host, pid: 7, implementer: 'route',
  })

  it('reads start lines and skips lines of any other type', () => {
    const text = `${JSON.stringify(start('s1', ['T-0001']))}\n${JSON.stringify({ type: 'other' })}\n\n`
    expect(parseShiftStarts(text).map(line => line.shift)).toEqual(['s1'])
    expect(parseShiftStarts('')).toEqual([])
    expect(() => parseShiftStarts('torn\n')).toThrow()
  })

  it('closes every ticket of a start with no ticket line as abandoned, which counts as an attempt', () => {
    const queue = [ticket('T-0001', 1), ticket('T-0002', 1), ticket('T-0003', 1)]
    const ended = { ...line('T-0003', null, 'none'), shift: 'ended' }
    const lines = abandonedLines(
      [start('dead', ['T-0001', 'T-0009']), start('ended', ['T-0003']), start('alive', ['T-0002'], 'this-host')],
      [ended],
      queue,
      '2026-09-29T01:00:00.000Z',
      candidate => candidate.host === 'this-host',
    )
    expect(lines).toEqual([{
      type: 'ticket',
      at: '2026-09-29T01:00:00.000Z',
      shift: 'dead',
      ticket: 'T-0001',
      seat: 'seed-tools-steward',
      division: 'harness-core',
      programId: '',
      implementer: 'route',
      model: '',
      department: { outcome: 'abandoned', sessionId: null },
      checks: [],
      review: { verdict: 'none', sessionId: null },
      integration: { outcome: 'skipped' },
      shipped: null,
      reason: `${ABANDONED_REASON}: shift dead started at 2026-09-28T20:00:00.000Z on gone-host over ${'b'.repeat(40)} and recorded no end`,
      tokens: 0,
      seconds: 0,
    }])
    expect(queueOrder(queue, lines).map(entry => entry.id)).toEqual(['T-0002', 'T-0003', 'T-0001'])
    expect(ticketStatuses(lines).get('T-0001')).toBe('open')
  })

  it('names the tickets and the closed shifts in the start commit', () => {
    const trailers = { coAuthor: 'Daliesk enterprise shift <noreply@anthropic.com>', session: 'https://claude.ai/code/session_x' }
    expect(shiftStartMessage('s2', ['T-0001', 'T-0002'], ['dead'], trailers).split('\n')).toEqual([
      'chore(enterprise): shift s2 starts over T-0001, T-0002',
      '',
      'Daliesk shift s2: its start line in data/enterprise/shift-starts.jsonl, pushed before any department runs.',
      `It closes dead, which started and recorded no end, as ${ABANDONED_REASON}.`,
      '',
      'Co-Authored-By: Daliesk enterprise shift <noreply@anthropic.com>',
      'Claude-Session: https://claude.ai/code/session_x',
    ])
    expect(shiftStartMessage('s2', ['T-0001'], [], trailers)).not.toContain('It closes')
  })
})

describe('the decisions no person made', () => {
  it('records the spec freeze and the release as the engine\'s, naming the shift, never a person', () => {
    const digest = 'a'.repeat(64)
    const principal = { kind: 'machine', id: ENGINE_PRINCIPAL_ID, decidedBy: 'the enterprise-shift engine, shift 184501-ab12' }
    expect(engineDecisions('184501-ab12', digest)).toEqual([
      { transition: 'spec-freeze', principal, artefactSha256: digest },
      { transition: 'release', principal, artefactSha256: digest },
    ])
  })
})

describe('the record', () => {
  it('masks credential- and personal-data-shaped strings with the shared patterns, then the shapes they do not name, and counts them', () => {
    const input = 'token sk-abcdefghijklmnop and AKIAABCDEFGHIJKLMNOP plus ghp_abcdefghijklmnopqrstuvwxyz1234, mail owner@example.com, plain words'
    const { text, redacted } = redactCredentials(input)
    expect(text).toBe('token [redacted] and [REDACTED-AWS-ACCESS-KEY] plus [REDACTED-GITHUB-TOKEN], mail [REDACTED-EMAIL], plain words')
    expect(redacted).toBe(4)
    expect(redactCredentials('nothing here').redacted).toBe(0)
  })

  it('finds on re-scan only what the masking left, by file, line, shape and digest', () => {
    const leaked = 'AKIAABCDEFGHIJKLMNOP'
    const files = [{ path: 'result.json', text: redactCredentials(`{"key": "${leaked}"}`).text }, { path: 'sessions/x.jsonl', text: `clean\nkey ${leaked}\n` }]
    expect(recordLeaks(files)).toEqual([{ file: 'sessions/x.jsonl', line: 2, pattern: 'aws-access-key', digest: createHash('sha256').update(leaked).digest('hex') }])
    expect(recordLeaks([files[0] ?? { path: '', text: '' }])).toEqual([])
  })

  it('names the shift by its UTC start', () => {
    const startedAt = new Date('2026-09-28T18:45:01.500Z')
    expect(shiftIdFor(startedAt, 'ab12')).toBe('184501-ab12')
    expect(shiftRecordName(startedAt, '184501-ab12')).toBe('2026-09-28-184501-ab12')
  })
})

describe('the tickets the engine refuses to work', () => {
  it('refuses a ticket whose acceptance chains a command outside the queue\'s forms, and names the check', () => {
    const pushing = { ...ticket('T-0008', 1), acceptance: [{ id: 'runs', run: 'node tools/x.mjs' }, { id: 'ships', run: 'grep -q x tools/x.mjs && git push origin HEAD' }] }
    const refusals = acceptanceRefusals([ticket('T-0007', 1), pushing], OPEN_QUEUE_POLICY)
    expect([...refusals.keys()]).toEqual(['T-0008'])
    expect(refusals.get('T-0008')).toBe(`${ACCEPTANCE_REFUSED_REASON} ships: \`git push\` is not an allowed acceptance command; only \`git diff\` is; the ticket must be rewritten before a shift works it`)
  })

  it('refuses under this repository\'s forms a direct run of a repository file the open queue allows', () => {
    expect(acceptanceRefusals([ticket('T-0007', 1)], OPEN_QUEUE_POLICY).size).toBe(0)
    expect(acceptanceRefusals([ticket('T-0007', 1)], HARNESS_QUEUE_POLICY).get('T-0007')).toMatch(/^refused: acceptance runs: `node` is not an allowed acceptance command/)
  })
})

describe('the environment of the commands the engine spawns itself', () => {
  const engine = {
    PATH: process.env['PATH'],
    HOME: '/home/engine',
    NODE_OPTIONS: '--max-old-space-size=8192',
    npm_config_store_dir: '/store',
    npm_config_https_proxy: 'http://proxy.invalid:3128',
    npm_config__authToken: 'npm-credential',
    ENTERPRISE_HEAVY_LOCK: '/tmp/heavy.lock',
    DSH_E2E_INSTALL_LOG: '/tmp/installs.log',
    GH_TOKEN: 'forge-credential',
    GIT_ASKPASS: '/usr/local/bin/askpass',
    GIT_CONFIG_COUNT: '1',
    HTTPS_PROXY: 'http://proxy.invalid:3128',
    ENTERPRISE_PUSH_LOCK: '/tmp/push.lock',
  }

  it('keeps the search path, the home directory, the node and pnpm variables, the heavy lock and the e2e install log, and nothing else', () => {
    expect(Object.keys(checkEnvironment(engine)).sort()).toEqual(['DSH_E2E_INSTALL_LOG', 'ENTERPRISE_HEAVY_LOCK', 'HOME', 'NODE_OPTIONS', 'PATH', 'npm_config_store_dir'])
  })

  it('does not hand a credential-named variable to a spawned check', () => {
    const check = spawnSync('bash', ['-c', 'test -z "${GH_TOKEN:-}" && test -z "${GIT_ASKPASS:-}" && test -n "$ENTERPRISE_HEAVY_LOCK"'], { env: checkEnvironment(engine) })
    expect(check.status).toBe(0)
    expect(spawnSync('bash', ['-c', 'test -z "${GH_TOKEN:-}"'], { env: engine }).status).toBe(1)
  })
})
