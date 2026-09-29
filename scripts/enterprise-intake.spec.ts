import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { Admission, Coordinator, Queue, Ticket, Verdict } from './enterprise-intake-admission.ts'
import {
  INTAKE_PRINCIPAL_ID,
  intakeDecisions,
  admissionCommand,
  assignRequests,
  coordinatorObjective,
  functionLine,
  functionOutcome,
  INTAKE_DEFAULTS,
  intakeId,
  intakePlan,
  parseCommand,
  REPO_ROOT,
  requestKey,
  requestObjective,
  requestResult,
} from './enterprise-intake.ts'
import type { DepartmentRecord, IntakeOptions } from './enterprise-intake.ts'
import type { TitledRequest } from './enterprise-requests.ts'
import type { RosterAgentDefinition } from './enterprise-roster.ts'

const GOAL = 'program-departments-goal-coordinator'
const JOBS = 'program-departments-jobs-coordinator'

function options(overrides: Partial<IntakeOptions> = {}): IntakeOptions {
  const command = parseCommand(['--root', '/repo', '--scratch', '/scratch'])
  if (command.kind !== 'intake') throw new Error('expected the intake form')
  return { ...command.options, ...overrides }
}

function coordinator(open: readonly Ticket[] = [], id = GOAL): Coordinator {
  const name = id === GOAL ? 'Goal' : 'Jobs'
  const seat = {
    id,
    name: `${name} Department Coordinator`,
    role: 'coordinator',
    division: 'program-departments',
    source: `packages/${name.toLowerCase()}/README.md`,
  } as unknown as RosterAgentDefinition
  return { seat, subsystem: `packages/${name.toLowerCase()}/`, open }
}

function request(name: string, title = 'Show the deck in dark mode'): TitledRequest {
  return { path: `data/enterprise/requests/${name}`, title, anchor: `# ${title}`, text: `# ${title}\n\nThe deck is too bright at night.\n` }
}

function queue(tickets: readonly Partial<Ticket>[], rejected: readonly string[] = []): Queue {
  return {
    loaded: [],
    tickets: tickets as Ticket[],
    statuses: new Map(rejected.map(id => [id, 'rejected' as const])),
  }
}

describe('parseCommand', () => {
  it('takes the validated defaults, dropping pnpm\'s own separator', () => {
    const command = parseCommand(['--', '--root', '/repo'], { DSH_ENTERPRISE_SCRATCH: '/shared/scratch' })
    expect(command).toEqual({
      kind: 'intake',
      options: {
        minOpen: 8,
        maxRequests: 2,
        coordinators: undefined,
        count: 2,
        maxTickets: 3,
        shift: undefined,
        composition: INTAKE_DEFAULTS.composition,
        root: '/repo',
        scratch: '/shared/scratch',
        install: 'pnpm install --offline --frozen-lockfile',
        exclude: ['data'],
        checkTimeoutMs: 120_000,
        keep: false,
      },
    })
  })

  it('reads every option', () => {
    const command = parseCommand([
      '--min-open', '12', '--max-requests', '5', '--coordinators', `${GOAL}, ${JOBS}`, '--count', '4', '--max-tickets', '1',
      '--shift', '2026-09-28T17-20Z', '--composition', 'c.yml', '--root', '/r', '--scratch', '/s', '--install', 'none',
      '--exclude', 'none', '--check-timeout-ms', '5000', '--keep',
    ])
    expect(command.kind === 'intake' ? command.options : undefined).toMatchObject({
      minOpen: 12,
      maxRequests: 5,
      coordinators: [GOAL, JOBS],
      count: 4,
      maxTickets: 1,
      shift: '2026-09-28T17-20Z',
      install: 'none',
      exclude: [],
      checkTimeoutMs: 5000,
      keep: true,
    })
  })

  it('reads the verifier form, a request\'s included', () => {
    expect(parseCommand(['admit', '--root', '/r', '--tip', '/t', '--seat', GOAL, '--proposals', '.intake/x.json', '--max-tickets', '2'])).toEqual({
      kind: 'admit',
      options: { root: '/r', tip: '/t', seat: GOAL, proposals: '.intake/x.json', maxTickets: 2, checkTimeoutMs: 120_000, request: undefined },
    })
    const answering = parseCommand(['admit', '--root', '/r', '--tip', '/t', '--seat', GOAL, '--proposals', '.intake/request-x.json', '--request', 'data/enterprise/requests/x.md'])
    expect(answering.kind === 'admit' ? answering.options.request : undefined).toBe('data/enterprise/requests/x.md')
  })

  it.each([
    [['--min-open', '0'], /--min-open must be a positive integer/],
    [['--max-requests', '0'], /--max-requests must be a positive integer/],
    [['--max-tickets', 'three'], /--max-tickets must be a positive integer/],
    [['--coordinators', ' , '], /--coordinators names no seat/],
    [['--exclude', '../data'], /--exclude takes top-level directory names/],
    [['--shift', 'a b'], /--shift must be/],
    [['--unknown'], /Unknown option/],
    [['admit', '--root', '/r'], /admit requires --tip/],
  ])('refuses %j', (argv, message) => {
    expect(() => parseCommand(argv)).toThrow(message)
  })
})

describe('the intake plan', () => {
  it('asks the coordinator for its group, the next id, the clean checkout, and the sources already filed', () => {
    const filed = queue([
      { id: 'T-0001', seat: GOAL, source: { path: 'packages/goal/goal/README.md', anchor: 'A limit' }, scope: ['packages/goal/goal/'] },
      { id: 'T-0002', seat: 'harness-core-agent-steward', source: { path: 'packages/core/agent/README.md', anchor: 'Other' }, scope: ['packages/core/agent/'] },
      { id: 'T-0003', seat: GOAL, source: { path: 'packages/goal/tool-goal/README.md', anchor: 'Refused' }, scope: ['packages/goal/tool-goal/'] },
    ], ['T-0003'])
    const text = coordinatorObjective(coordinator(), filed, options(), '/scratch/tip')
    expect(text.startsWith(`Goal Department Coordinator, roster seat \`${GOAL}\`: intake for the package group under \`packages/goal/\`.`)).toBe(true)
    expect(text).toContain('find at most 3 small, real pieces of work in `packages/goal/`')
    expect(text).toContain(`\`.intake/${GOAL}.json\``)
    expect(text).toContain('`id` ("T-0004", then the next ids in order')
    expect(text).toContain(`that is \`${GOAL}\` in division \`program-departments\``)
    expect(text).toContain('`/scratch/tip` is a clean checkout of this tree with its dependencies installed')
    expect(text).toContain('Do not run the typecheck, doc-sync or coverage commands anywhere')
    expect(text).toContain('leave out `data/` apart from `data/enterprise/`')
    expect(text).toContain('`packages/goal/goal/README.md` (anchor "A limit", T-0001)')
    expect(text).not.toContain('T-0002')
    expect(text).not.toContain('Refused')
  })

  it('states an empty group and no left-out directory when there is none', () => {
    const text = coordinatorObjective(coordinator(), queue([]), options({ exclude: [], maxTickets: 1 }), '/tip')
    expect(text).toContain('The queue holds no open or shipped ticket in this package group.')
    expect(text).toContain('`id` ("T-0001", then')
    expect(text).not.toContain('leave out')
  })

  it('gives each coordinator one department measured by its admission of what it committed', () => {
    const plan = intakePlan({ requests: [], coordinators: [coordinator()] }, queue([]), options({ maxTickets: 2 }), 'a'.repeat(40), '/scratch/tip')
    expect(plan.objective).toBe(`intake: the ${GOAL} coordinators propose tickets for their package groups`)
    expect(plan.baseRevision).toBe('a'.repeat(40))
    expect(plan.gates).toEqual(['test -z "$(git status --porcelain)"'])
    expect(plan.departments.map(department => [department.key, department.checks.map(check => check.id)])).toEqual([[GOAL, ['admission']]])
    expect(plan.departments[0]?.checks[0]?.run).toBe(admissionCommand({ key: GOAL, seat: GOAL }, options({ maxTickets: 2 }), '/scratch/tip'))
    expect(admissionCommand({ key: GOAL, seat: GOAL }, options({ maxTickets: 2 }), '/scratch/tip')).toBe([
      join(REPO_ROOT, 'node_modules/.bin/tsx'),
      join(REPO_ROOT, 'scripts/enterprise-intake.ts'),
      `admit --root /repo --tip /scratch/tip --seat ${GOAL} --proposals .intake/${GOAL}.json --max-tickets 2 --check-timeout-ms 120000`,
    ].join(' '))
  })
})

describe('the owner\'s requests', () => {
  it.each([
    ['data/enterprise/requests/a-drain-cap.md', 'request-a-drain-cap'],
    ['data/enterprise/requests/Dark Mode, please!.MD', 'request-dark-mode-please'],
    ['data/enterprise/requests/暗色模式.md', 'request'],
    [`data/enterprise/requests/${'x'.repeat(60)}.md`, `request-${'x'.repeat(48)}`],
  ])('keys the department of %s as %s', (path, key) => {
    expect(requestKey(path)).toBe(key)
  })

  it('answers the first --max-requests in file-name order, staffed by the coordinators in turn, each under a key of its own', () => {
    const ranked = [coordinator([], JOBS), coordinator()]
    const pending = [request('dark mode.md'), request('dark-mode.md'), request('暗色.md'), request('later.md')]
    const assigned = assignRequests(pending, ranked, 3)
    expect(assigned.map(assignment => [assignment.request.path, assignment.key, assignment.coordinator.seat.id])).toEqual([
      ['data/enterprise/requests/dark mode.md', 'request-dark-mode', JOBS],
      ['data/enterprise/requests/dark-mode.md', 'request-dark-mode-2', GOAL],
      ['data/enterprise/requests/暗色.md', 'request', JOBS],
    ])
    expect(assignRequests([], [], 2)).toEqual([])
    expect(() => assignRequests(pending, [], 1)).toThrow('no Program Departments coordinator can answer data/enterprise/requests/dark mode.md')
  })

  it('tells a request\'s department the request verbatim, the one ticket it becomes, its source and priority 0', () => {
    const text = requestObjective({ request: request('dark.md'), key: 'request-dark', coordinator: coordinator() }, queue([{ id: 'T-0001' }, { id: 'T-0002' }]), options(), '/scratch/tip')
    expect(text.startsWith(`Goal Department Coordinator, roster seat \`${GOAL}\`: intake of one of the owner's requests, \`data/enterprise/requests/dark.md\`.`)).toBe(true)
    expect(text).toContain('<request>\n# Show the deck in dark mode\n\nThe deck is too bright at night.\n</request>')
    expect(text).toContain('turn this request into exactly one ticket')
    expect(text).toContain('Write the ticket as a JSON array holding exactly that one ticket to `.intake/request-dark.json` at the root of this worktree')
    expect(text).toContain('`id` ("T-0003";')
    expect(text).toContain('of the seats in `data/enterprise/roster.json` whose `source` covers every path in `scope`')
    expect(text).toContain('`source` (exactly `{"path":"data/enterprise/requests/dark.md","anchor":"# Show the deck in dark mode"}`')
    expect(text).toContain('`priority` (`0`, which the queue reserves for a ticket answering a request')
    expect(text).toContain('`/scratch/tip` is a clean checkout of this tree with its dependencies installed')
    expect(text).toContain('leave out `data/` apart from `data/enterprise/`')
  })

  it('puts the requests\' departments before the refilling coordinators\', each measured by admission of one ticket', () => {
    const answering = { request: request('dark mode.md'), key: 'request-dark-mode', coordinator: coordinator() }
    const plan = intakePlan({ requests: [answering], coordinators: [coordinator([], JOBS)] }, queue([]), options(), 'a'.repeat(40), '/scratch/tip')
    expect(plan.objective).toBe(`intake: the owner's requests data/enterprise/requests/dark mode.md become tickets; the ${JOBS} coordinators propose tickets for their package groups`)
    expect(plan.departments.map(department => [department.key, department.checks.map(check => check.id)])).toEqual([['request-dark-mode', ['admission']], [JOBS, ['admission']]])
    expect(plan.departments[0]?.checks[0]?.run).toBe([
      join(REPO_ROOT, 'node_modules/.bin/tsx'),
      join(REPO_ROOT, 'scripts/enterprise-intake.ts'),
      `admit --root /repo --tip /scratch/tip --seat ${GOAL} --proposals .intake/request-dark-mode.json --max-tickets 1 --request 'data/enterprise/requests/dark mode.md' --check-timeout-ms 120000`,
    ].join(' '))
    expect(admissionCommand({ key: 'request-it-s', seat: GOAL, request: 'data/enterprise/requests/it\'s.md' }, options(), '/tip'))
      .toContain('--request \'data/enterprise/requests/it\'\\\'\'s.md\'')
  })

  function departmentRecord(fields: { readonly status?: string; readonly outcome?: DepartmentRecord['outcome']; readonly admitted?: string[]; readonly admission?: Admission }): DepartmentRecord {
    return {
      department: { status: fields.status ?? 'failed', tokens: 0, seconds: 0 },
      ran: true,
      outcome: fields.outcome ?? 'fail',
      admitted: fields.admitted ?? [],
      proposals: [],
      admission: fields.admission ?? { verdicts: [] },
    }
  }

  function refusal(index: number, code: NonNullable<Verdict['code']>, reason: string): Verdict {
    return { index, proposedId: null, title: null, admitted: false, code, reason, checks: [] }
  }

  it.each([
    ['an admitted ticket', departmentRecord({ status: 'merged', outcome: 'pass', admitted: ['T-0042'] }), { result: 'admitted', ticket: 'T-0042' }],
    [
      'refused proposals, with every reason',
      departmentRecord({ admission: { verdicts: [refusal(0, 'request', 'a ticket answering a request takes priority 0'), refusal(1, 'over-limit', 'only the first 1 proposals of a coordinator are admitted')] } }),
      { result: 'refused', reason: 'a ticket answering a request takes priority 0; only the first 1 proposals of a coordinator are admitted' },
    ],
    ['a file that is not JSON', departmentRecord({ admission: { verdicts: [], error: 'the committed proposals are not JSON: x' } }), { result: 'refused', reason: 'the committed proposals are not JSON: x' }],
    ['a department that ended without a ticket', departmentRecord({}), { result: 'refused', reason: 'its department ended failed without committing a ticket' }],
    [
      'a department the usage limit cut',
      departmentRecord({ status: 'blocked', outcome: 'error', admission: { verdicts: [refusal(0, 'not-certified', 'the department did not certify, so none of its proposals is admitted')] } }),
      { result: 'unanswered' },
    ],
    ['a department never started', departmentRecord({ status: 'blocked', outcome: 'error' }), { result: 'unanswered' }],
  ])('reads %s as what the intake did with the request', (_label, record, expected) => {
    expect(requestResult(record)).toEqual(expected)
  })
})

describe('the ledger', () => {
  it.each([
    ['merged', ['T-0038'], false, 'pass'],
    ['certified', ['T-0038'], true, 'pass'],
    ['failed', [], false, 'fail'],
    ['merged', [], false, 'fail'],
    ['blocked', [], true, 'error'],
    ['blocked', [], false, 'error'],
    ['failed', [], true, 'error'],
    ['abandoned', [], false, 'error'],
  ] as const)('reads a %s department that admitted %j (limited: %s) as %s', (status, admitted, limited, outcome) => {
    expect(functionOutcome(status, admitted, limited)).toBe(outcome)
  })

  it('writes one function line with the shared field set, in order', () => {
    const line = functionLine({
      at: '2026-09-28T17:20:00.000Z',
      shift: '172000-abcd',
      seat: GOAL,
      division: 'program-departments',
      commit: 'c'.repeat(40),
      outcome: 'pass',
      evidence: `data/enterprise/intake/2026-09-28-172000-abcd/${GOAL}.json`,
      seconds: 42,
    })
    expect(line.endsWith('\n')).toBe(true)
    expect(JSON.parse(line)).toEqual({
      type: 'function',
      at: '2026-09-28T17:20:00.000Z',
      shift: '172000-abcd',
      seat: GOAL,
      division: 'program-departments',
      function: 'intake',
      target: { commit: 'c'.repeat(40) },
      outcome: 'pass',
      evidence: { path: `data/enterprise/intake/2026-09-28-172000-abcd/${GOAL}.json` },
      seconds: 42,
    })
    expect(Object.keys(JSON.parse(line) as object)).toEqual(['type', 'at', 'shift', 'seat', 'division', 'function', 'target', 'outcome', 'evidence', 'seconds'])
  })

  it('names an intake by its start time and a random suffix', () => {
    expect(intakeId(new Date('2026-09-28T17:20:05.123Z'))).toMatch(/^172005-[0-9a-f]{4}$/)
  })
})

describe('the decisions no person made', () => {
  it('records the spec freeze and the release as the intake\'s own, naming the run', () => {
    const principal = { kind: 'machine', id: INTAKE_PRINCIPAL_ID, decidedBy: 'the enterprise intake, run ab12cd' }
    expect(intakeDecisions('ab12cd', 'f'.repeat(64))).toEqual([
      { transition: 'spec-freeze', principal, artefactSha256: 'f'.repeat(64) },
      { transition: 'release', principal, artefactSha256: 'f'.repeat(64) },
    ])
  })
})
