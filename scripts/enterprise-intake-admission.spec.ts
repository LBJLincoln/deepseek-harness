import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import {
  admitProposals,
  checkRole,
  coordinators,
  coveredPrefix,
  covers,
  formatTicket,
  maskCredentials,
  owningSeats,
  readQueue,
  scrubbedEnvironment,
  selectCoordinators,
  shellCheckRunner,
  ticketStatuses,
  uncertified,
} from './enterprise-intake-admission.ts'
import type { AdmissionContext, CheckRun, Ticket, TicketCheck } from './enterprise-intake-admission.ts'
import type { Roster } from './enterprise-roster.ts'
import { loadTickets, validateTickets } from './enterprise-tickets.ts'

const roots: string[] = []

afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const ALPHA = 'program-departments-alpha-coordinator'
const BETA = 'program-departments-beta-coordinator'
const CORE = 'harness-core-alpha-core-steward'

const ROSTER = {
  divisions: [{ id: 'program-departments' }, { id: 'harness-core' }],
  agents: [
    { id: ALPHA, name: 'Alpha Department Coordinator', role: 'coordinator', division: 'program-departments', source: 'packages/alpha/README.md' },
    { id: BETA, name: 'Beta Department Coordinator', role: 'coordinator', division: 'program-departments', source: 'packages/beta/README.md' },
    { id: CORE, name: 'Alpha Core Steward', role: 'steward', division: 'harness-core', source: 'packages/alpha/core/README.md' },
    { id: 'curation-data-notes-curator', name: 'Notes Curator', role: 'curator', division: 'harness-core', source: 'notes' },
    { id: 'verification-verify-thing', name: 'Verify Thing', role: 'verifier', division: 'harness-core', source: 'scripts/verify-thing.ts' },
  ],
} as unknown as Roster

/** A tree holding the roster's sources, three packages, and a queue of `queued` tickets. */
function tree(queued: readonly Ticket[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'intake-admission-'))
  roots.push(root)
  const files: Record<string, string> = {
    'packages/alpha/README.md': '# alpha\n\n## Known Limitations and Deferred Work\n\n- The drain is unbounded.\n- Timeouts are fixed.\n',
    'packages/alpha/src/queue.ts': 'export const drain = 1\n',
    'packages/alpha/core/README.md': '# alpha core\n',
    'packages/beta/README.md': '# beta\n\n- Retries are unbounded.\n',
    'notes/one.md': '# note\n',
    'scripts/verify-thing.ts': 'export {}\n',
    'data/enterprise/roster.json': JSON.stringify(ROSTER),
  }
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  mkdirSync(join(root, 'data/enterprise/tickets'), { recursive: true })
  for (const ticket of queued) writeFileSync(join(root, `data/enterprise/tickets/${ticket.id}.json`), formatTicket(ticket))
  return root
}

/** A ticket every rule admits, owned by the alpha coordinator. */
function proposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'T-0099',
    title: 'Bound the alpha drain',
    division: 'program-departments',
    seat: ALPHA,
    kind: 'fix',
    source: { path: 'packages/alpha/README.md', anchor: 'The drain is unbounded.' },
    task: 'Problem: packages/alpha/src/queue.ts:1 drains everything. Required: bound it.',
    scope: ['packages/alpha/'],
    acceptance: [
      { id: 'bounded', run: 'grep -q maxJobs packages/alpha/src/queue.ts' },
      { id: 'coverage', run: 'pnpm exec vitest run packages/alpha/ --coverage' },
      { id: 'typecheck', run: 'pnpm run typecheck' },
    ],
    budget: { maxTotalTokens: 8_000_000, maxWallMs: 2_700_000 },
    priority: 1,
    ...overrides,
  }
}

function queued(id: string, overrides: Record<string, unknown> = {}): Ticket {
  return { ...proposal(overrides), id } as unknown as Ticket
}

/** A runner that answers each command from a table, recording what it ran; unlisted commands fail. */
function stubRunner(exitCodes: Record<string, number | 'timeout'> = {}): { runCheck: (check: TicketCheck) => Promise<CheckRun>; ran: string[] } {
  const ran: string[] = []
  return {
    ran,
    runCheck: async (check) => {
      ran.push(check.run)
      const outcome = exitCodes[check.run] ?? 1
      return {
        id: check.id,
        run: check.run,
        exitCode: outcome === 'timeout' ? null : outcome,
        signal: outcome === 'timeout' ? 'SIGKILL' : null,
        timedOut: outcome === 'timeout',
        seconds: 0,
        output: '',
        dirtied: [],
      }
    },
  }
}

function context(root: string, runCheck: AdmissionContext['runCheck'], admitted: readonly Ticket[] = []): AdmissionContext {
  return { roster: ROSTER, tip: root, queue: readQueue(root), admitted, runCheck }
}

describe('ticketStatuses', () => {
  it('reads each ticket from its latest ticket line by the engine\'s rule', () => {
    const lines = [
      { type: 'ticket', ticket: 'T-0001', shipped: null, review: { verdict: 'none' } },
      { type: 'ticket', ticket: 'T-0001', shipped: { commit: 'abc' }, review: { verdict: 'approve' } },
      { ticket: 'T-0002', shipped: null, review: { verdict: 'reject' } },
      { type: 'ticket', ticket: 'T-0003', shipped: null, review: { verdict: 'approve' } },
      { type: 'function', seat: 'x', function: 'intake', outcome: 'pass' },
    ].map(line => JSON.stringify(line))
    const statuses = ticketStatuses(`${lines.join('\n')}\n{torn\n\n`)
    expect([...statuses]).toEqual([['T-0001', 'shipped'], ['T-0002', 'rejected'], ['T-0003', 'open']])
  })

  it('reads an absent ledger as every ticket open', () => {
    expect(ticketStatuses('').size).toBe(0)
  })
})

describe('coverage and ownership', () => {
  it('covers a README\'s directory, a directory, or exactly one file', () => {
    const root = tree()
    expect(coveredPrefix('packages/alpha/README.md', root)).toBe('packages/alpha/')
    expect(coveredPrefix('notes', root)).toBe('notes/')
    expect(coveredPrefix('scripts/verify-thing.ts', root)).toBe('scripts/verify-thing.ts')
    expect(covers('packages/alpha/', 'packages/alpha/src/queue.ts')).toBe(true)
    expect(covers('packages/alpha/', 'packages/alpha')).toBe(true)
    expect(covers('packages/alpha/', 'packages/alphabet/')).toBe(false)
    expect(covers('scripts/verify-thing.ts', 'scripts/verify-thing.ts')).toBe(true)
    expect(covers('scripts/verify-thing.ts', 'scripts/verify-thing.spec.ts')).toBe(false)
  })

  it('gives a scope to the most specific seat covering every entry', () => {
    const root = tree()
    expect(owningSeats(ROSTER, root, ['packages/alpha/src/'])).toEqual([ALPHA])
    expect(owningSeats(ROSTER, root, ['packages/alpha/core/'])).toEqual([CORE])
    expect(owningSeats(ROSTER, root, ['packages/alpha/core/', 'packages/alpha/src/'])).toEqual([ALPHA])
    expect(owningSeats(ROSTER, root, ['packages/alpha/', 'packages/beta/'])).toEqual([])
  })
})

describe('coordinator selection', () => {
  it('counts the open tickets a coordinator owns or whose scope or source lies in its group', () => {
    const root = tree([
      queued('T-0001', { seat: BETA, source: { path: 'packages/beta/README.md', anchor: 'Retries are unbounded.' }, scope: ['packages/beta/'] }),
      queued('T-0002', { seat: CORE, division: 'harness-core', scope: ['packages/alpha/core/'] }),
    ])
    const queue = readQueue(root)
    const all = coordinators(ROSTER, root, queue.tickets)
    expect(all.map(coordinator => [coordinator.seat.id, coordinator.subsystem, coordinator.open.map(ticket => ticket.id)])).toEqual([
      [ALPHA, 'packages/alpha/', ['T-0002']],
      [BETA, 'packages/beta/', ['T-0001']],
    ])
  })

  it('takes the coordinators with the fewest open tickets first, roster order breaking ties', () => {
    const root = tree([queued('T-0001', { seat: BETA, scope: ['packages/beta/'] }), queued('T-0002', { seat: BETA, scope: ['packages/beta/'] })])
    const all = coordinators(ROSTER, root, readQueue(root).tickets)
    expect(selectCoordinators(all, undefined, 1).map(coordinator => coordinator.seat.id)).toEqual([ALPHA])
    expect(selectCoordinators(all, [BETA, ALPHA], 1).map(coordinator => coordinator.seat.id)).toEqual([ALPHA, BETA])
    expect(() => selectCoordinators(all, [CORE], 1)).toThrow(/is not a program-departments coordinator/)
  })
})

describe('checkRole', () => {
  it('separates the queue\'s guards from a ticket\'s own checks', () => {
    expect(checkRole('pnpm run typecheck')).toBe('gate')
    expect(checkRole('pnpm run doc-sync')).toBe('gate')
    expect(checkRole('pnpm exec vitest run packages/alpha/ --coverage')).toBe('coverage')
    expect(checkRole('pnpm run typecheck && grep -q x y')).toBe('own')
    expect(checkRole('test -f packages/alpha/tests/new.spec.ts')).toBe('own')
  })
})

describe('admitProposals', () => {
  it('admits a proposal whose own checks all fail, under the next free id, and runs no guard', async () => {
    const root = tree([queued('T-0001', { source: { path: 'packages/alpha/README.md', anchor: 'Timeouts are fixed.' } })])
    const { runCheck, ran } = stubRunner()
    const { verdicts } = await admitProposals([proposal()], 3, context(root, runCheck))
    expect(verdicts.map(verdict => [verdict.admitted, verdict.id, verdict.proposedId])).toEqual([[true, 'T-0002', 'T-0099']])
    expect(ran).toEqual(['grep -q maxJobs packages/alpha/src/queue.ts'])
    const ticket = verdicts[0]?.ticket
    expect(ticket?.id).toBe('T-0002')
    expect(Object.keys(ticket ?? {})).toEqual(['id', 'title', 'division', 'seat', 'kind', 'source', 'task', 'scope', 'acceptance', 'budget', 'priority'])
  })

  it('refuses by each rule, and a refused proposal takes no id', async () => {
    const root = tree([
      queued('T-0001', { source: { path: 'packages/alpha/README.md', anchor: 'Timeouts are fixed.' } }),
      queued('T-0002', { source: { path: 'packages/beta/README.md', anchor: 'Retries are unbounded.' }, seat: BETA, scope: ['packages/beta/'] }),
    ])
    writeFileSync(join(root, 'data/enterprise/ledger.jsonl'), `${JSON.stringify({ type: 'ticket', ticket: 'T-0002', shipped: null, review: { verdict: 'reject' } })}\n`)
    const passing = 'grep -q drain packages/alpha/src/queue.ts'
    const slow = 'sleep 600'
    const { runCheck } = stubRunner({ [passing]: 0, [slow]: 'timeout' })
    const proposals = [
      proposal({ status: 'open' }),
      proposal({ seat: BETA }),
      proposal({ source: { path: 'packages/alpha/README.md', anchor: 'Timeouts are fixed.' } }),
      proposal({ acceptance: [{ id: 'coverage', run: 'pnpm exec vitest run packages/alpha/ --coverage' }, { id: 'typecheck', run: 'pnpm run typecheck' }] }),
      proposal({ acceptance: [{ id: 'drains', run: passing }, { id: 'coverage', run: 'x --coverage' }, { id: 'typecheck', run: 'pnpm run typecheck' }] }),
      proposal({ acceptance: [{ id: 'slow', run: slow }, { id: 'coverage', run: 'x --coverage' }, { id: 'typecheck', run: 'pnpm run typecheck' }] }),
      // A rejected ticket's source may be filed again, and this one is admitted.
      proposal({ seat: BETA, scope: ['packages/beta/'], source: { path: 'packages/beta/README.md', anchor: 'Retries are unbounded.' } }),
      'not an object',
    ]
    const { verdicts } = await admitProposals(proposals, 8, context(root, runCheck))
    expect(verdicts.map(verdict => [verdict.index, verdict.admitted ? verdict.id : verdict.code])).toEqual([
      [0, 'invalid'],
      [1, 'owner'],
      [2, 'duplicate'],
      [3, 'no-own-check'],
      [4, 'passes-before'],
      [5, 'timeout'],
      [6, 'T-0003'],
      [7, 'invalid'],
    ])
    expect(verdicts[0]?.reason).toMatch(/unknown field "status"/)
    expect(verdicts[1]?.reason).toBe(`seat ${BETA} does not own the scope: its scope is owned by ${ALPHA}`)
    expect(verdicts[2]?.reason).toMatch(/^T-0001 already carries the source/)
    expect(verdicts[4]?.checks.map(check => check.exitCode)).toEqual([0])
  })

  it('refuses a proposal repeating one admitted earlier in the same intake, and proposals past the limit', async () => {
    const root = tree()
    const { runCheck } = stubRunner()
    const first = await admitProposals([proposal()], 1, context(root, runCheck))
    const earlier = first.verdicts.flatMap(verdict => (verdict.ticket === undefined ? [] : [verdict.ticket]))
    expect(earlier.map(ticket => ticket.id)).toEqual(['T-0001'])
    const second = await admitProposals([
      proposal({ seat: ALPHA, title: 'The same drain, seen twice' }),
      proposal({ source: { path: 'packages/alpha/README.md', anchor: 'Timeouts are fixed.' } }),
    ], 1, context(root, runCheck, earlier))
    expect(second.verdicts.map(verdict => [verdict.code, verdict.reason])).toEqual([
      ['duplicate', 'T-0001 already carries the source packages/alpha/README.md and its anchor'],
      ['over-limit', 'only the first 1 proposals of a coordinator are admitted'],
    ])
  })

  it('refuses a file that is not an array', async () => {
    const root = tree()
    expect(await admitProposals({ tickets: [] }, 3, context(root, stubRunner().runCheck))).toEqual({
      verdicts: [],
      error: 'the proposals file must hold one JSON array of tickets',
    })
  })

  it('turns every admission of an uncertified department into a refusal', async () => {
    const root = tree()
    const admission = await admitProposals([proposal(), proposal({ seat: BETA })], 3, context(root, stubRunner().runCheck))
    expect(uncertified(admission).verdicts.map(verdict => [verdict.admitted, verdict.code])).toEqual([[false, 'not-certified'], [false, 'owner']])
  })
})

describe('formatTicket', () => {
  it('writes a file the queue reads back and the validator accepts', async () => {
    const root = tree()
    const { verdicts } = await admitProposals([proposal()], 1, context(root, stubRunner().runCheck))
    const ticket = verdicts[0]?.ticket as Ticket
    writeFileSync(join(root, 'data/enterprise/tickets/T-0001.json'), formatTicket(ticket))
    expect(JSON.parse(readFileSync(join(root, 'data/enterprise/tickets/T-0001.json'), 'utf8'))).toEqual(ticket)
    expect(validateTickets(loadTickets(root), ROSTER, root)).toEqual([])
    expect(formatTicket(ticket)).toMatch(/\n {4}\{ "id": "bounded", "run": "grep -q maxJobs packages\/alpha\/src\/queue.ts" \},\n/)
  })
})

describe('credential handling', () => {
  it('masks credential-shaped strings and keeps JSON parseable', () => {
    const key = `sk-ant-${'A1b2C3d4E5'.repeat(3)}`
    const { text, hits } = maskCredentials(JSON.stringify({ output: `token ${key} and ghp_${'x'.repeat(36)}` }))
    expect(JSON.parse(text)).toEqual({ output: 'token [masked:anthropic-key] and [masked:github-token]' })
    expect(hits).toEqual({ 'anthropic-key': 1, 'github-token': 1 })
  })

  it('hands an acceptance command no variable whose name marks a credential, and no git config set', () => {
    expect(scrubbedEnvironment({
      PATH: '/bin',
      DEEPSEEK_API_KEY: 'x',
      GH_TOKEN: 'y',
      DB_PASSWORD: 'z',
      CLIENT_SECRET: 'w',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'credential.helper',
      GIT_CONFIG_VALUE_0: 'store',
      GIT_DIR: '.git',
      HOME: '/h',
    })).toEqual({ PATH: '/bin', GIT_DIR: '.git', HOME: '/h' })
  })
})

describe('shellCheckRunner', () => {
  it('runs a command in the tip, keeps its output, and resets what it changed', async () => {
    const root = tree()
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
    git('init', '-q', '.')
    git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-q', '--allow-empty', '-m', 'empty')
    git('add', '-A')
    git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'tree')
    const commit = git('rev-parse', 'HEAD')
    const run = shellCheckRunner({ tip: root, commit, timeoutMs: 20_000, outputChars: 40 })
    const failing = await run({ id: 'absent', run: 'echo checking; grep -q maxJobs packages/alpha/src/queue.ts' })
    expect([failing.exitCode, failing.timedOut, failing.output, failing.dirtied]).toEqual([1, false, 'checking\n', []])
    const dirtying = await run({ id: 'dirty', run: 'echo x >> packages/alpha/src/queue.ts && touch stray.txt' })
    expect(dirtying.exitCode).toBe(0)
    expect(dirtying.dirtied).toEqual([' M packages/alpha/src/queue.ts', '?? stray.txt'])
    expect(git('status', '--porcelain')).toBe('')
    const moving = await run({ id: 'moves', run: 'git checkout -q HEAD~1' })
    expect(moving.dirtied).toContain(`HEAD moved to ${git('rev-parse', 'HEAD~1')}`)
    expect(git('rev-parse', 'HEAD')).toBe(commit)
  })

  it('kills a command that outlives the timeout', async () => {
    const root = tree()
    execFileSync('git', ['init', '-q', '.'], { cwd: root })
    const run = shellCheckRunner({ tip: root, commit: 'unused', timeoutMs: 300, outputChars: 100 })
    const slow = await run({ id: 'slow', run: 'sleep 30' })
    expect([slow.exitCode, slow.timedOut, slow.signal]).toEqual([null, true, 'SIGKILL'])
  })
})
