import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { Coordinator, Queue, Ticket } from './enterprise-intake-admission.ts'
import {
  INTAKE_PRINCIPAL_ID,
  intakeDecisions,
  admissionCommand,
  coordinatorObjective,
  functionLine,
  functionOutcome,
  INTAKE_DEFAULTS,
  intakeId,
  intakePlan,
  parseCommand,
  REPO_ROOT,
} from './enterprise-intake.ts'
import type { IntakeOptions } from './enterprise-intake.ts'
import type { RosterAgentDefinition } from './enterprise-roster.ts'

const GOAL = 'program-departments-goal-coordinator'

function options(overrides: Partial<IntakeOptions> = {}): IntakeOptions {
  const command = parseCommand(['--root', '/repo', '--scratch', '/scratch'])
  if (command.kind !== 'intake') throw new Error('expected the intake form')
  return { ...command.options, ...overrides }
}

function coordinator(open: readonly Ticket[] = []): Coordinator {
  const seat = {
    id: GOAL,
    name: 'Goal Department Coordinator',
    role: 'coordinator',
    division: 'program-departments',
    source: 'packages/goal/README.md',
  } as unknown as RosterAgentDefinition
  return { seat, subsystem: 'packages/goal/', open }
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
      '--min-open', '12', '--coordinators', `${GOAL}, program-departments-jobs-coordinator`, '--count', '4', '--max-tickets', '1',
      '--shift', '2026-09-28T17-20Z', '--composition', 'c.yml', '--root', '/r', '--scratch', '/s', '--install', 'none',
      '--exclude', 'none', '--check-timeout-ms', '5000', '--keep',
    ])
    expect(command.kind === 'intake' ? command.options : undefined).toMatchObject({
      minOpen: 12,
      coordinators: [GOAL, 'program-departments-jobs-coordinator'],
      count: 4,
      maxTickets: 1,
      shift: '2026-09-28T17-20Z',
      install: 'none',
      exclude: [],
      checkTimeoutMs: 5000,
      keep: true,
    })
  })

  it('reads the verifier form', () => {
    expect(parseCommand(['admit', '--root', '/r', '--tip', '/t', '--seat', GOAL, '--proposals', '.intake/x.json', '--max-tickets', '2'])).toEqual({
      kind: 'admit',
      options: { root: '/r', tip: '/t', seat: GOAL, proposals: '.intake/x.json', maxTickets: 2, checkTimeoutMs: 120_000 },
    })
  })

  it.each([
    [['--min-open', '0'], /--min-open must be a positive integer/],
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
    const plan = intakePlan([coordinator()], queue([]), options({ maxTickets: 2 }), 'a'.repeat(40), '/scratch/tip')
    expect(plan.baseRevision).toBe('a'.repeat(40))
    expect(plan.gates).toEqual(['test -z "$(git status --porcelain)"'])
    expect(plan.departments.map(department => [department.key, department.checks.map(check => check.id)])).toEqual([[GOAL, ['admission']]])
    expect(plan.departments[0]?.checks[0]?.run).toBe(admissionCommand(GOAL, options({ maxTickets: 2 }), '/scratch/tip'))
    expect(admissionCommand(GOAL, options({ maxTickets: 2 }), '/scratch/tip')).toBe([
      join(REPO_ROOT, 'node_modules/.bin/tsx'),
      join(REPO_ROOT, 'scripts/enterprise-intake.ts'),
      `admit --root /repo --tip /scratch/tip --seat ${GOAL} --proposals .intake/${GOAL}.json --max-tickets 2 --check-timeout-ms 120000`,
    ].join(' '))
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
