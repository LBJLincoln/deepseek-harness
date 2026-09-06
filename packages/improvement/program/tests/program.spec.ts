/**
 * The program service over the real session, goal, verification, and
 * persistence plugins with a scripted shell, a stubbed roster, and turns the
 * test owns: what the ledger records, when a department starts, what a
 * restart reconciles, and how a program ends when it cannot reach a release.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { CheckId } from '@deepseek-ai/dsh-verification/types'
import ProgramService, { ProgramError, programIdFor, programSpecDigest, resolveProgramSpec } from '@deepseek-ai/dsh-program'
import type { ProgramGoalSpec, ProgramSpec } from '@deepseek-ai/dsh-program'
import { implementerPreset, programHarness, stubAgent, type ProgramHarness, type ScriptedRun } from './harness.ts'

const harnesses: ProgramHarness[] = []
const roots: string[] = []

/** The artefact digest a signed spec names, and one that is not it. */
const ARTEFACT = 'a'.repeat(64)
const OTHER_ARTEFACT = 'b'.repeat(64)

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Mount one harness and retire it after the case. */
async function mount(...args: Parameters<typeof programHarness>): Promise<ProgramHarness> {
  const harness = await programHarness(...args)
  harnesses.push(harness)
  return harness
}

/** One goal with every field a program requires. */
function goal(overrides: Partial<ProgramGoalSpec> = {}): ProgramGoalSpec {
  return {
    key: 'api',
    objective: 'deliver the api',
    preset: 'implementing',
    isolation: 'none',
    budget: { maxTotalTokens: 1_000 },
    dependsOn: [],
    checks: [{ id: 'api-builds' as CheckId, outcome: 'the api builds', run: 'check-api' }],
    ...overrides,
  }
}

/** One well-formed spec with the goals a case needs. */
function spec(goals: readonly ProgramGoalSpec[] = [goal()], overrides: Partial<ProgramSpec> = {}): ProgramSpec {
  return {
    objective: 'ship the release',
    baseRevision: 'base',
    goals,
    integration: {
      checks: [{ id: 'merged-builds' as CheckId, outcome: 'the merged head builds', run: 'check-merged' }],
      gates: [],
    },
    ...overrides,
  }
}

/** The default script: every git command and every check succeeds. */
function passing(command: string): ScriptedRun {
  return command.startsWith('git rev-parse') ? { stdout: 'headsha\n' } : {}
}

/** A script that fails the named check commands and passes everything else. */
function failing(...commands: readonly string[]): (command: string) => ScriptedRun {
  return command => (commands.includes(command) ? { exitCode: 1, stderr: 'no' } : passing(command))
}

/** Every `program/goal` status the ledger recorded for one key, in log order. */
async function statuses(harness: ProgramHarness, sessionId: string, key: string): Promise<string[]> {
  const { events } = await harness.ctx.sessionPersistence.inspect(sessionId as SessionId)
  return events
    .filter((event): event is SessionEvent<'program/goal'> => event.type === 'program/goal')
    .filter(event => event.data.key === key)
    .map(event => event.data.status)
}

/** The evidence the first recorded run states for its first check. */
function recordedEvidence(events: readonly SessionEvent[]): string {
  const run = events.find((event): event is SessionEvent<'verification/run'> => event.type === 'verification/run')
  return run?.data.results[0]?.evidence ?? ''
}

/** Every event type the ledger carries, in log order. */
async function ledgerTypes(harness: ProgramHarness, sessionId: string): Promise<string[]> {
  const { events } = await harness.ctx.sessionPersistence.inspect(sessionId as SessionId)
  return events.map((event: SessionEvent) => event.type)
}

describe('program configuration', () => {
  it('refuses a workspace root that is not an absolute unquotable path', async () => {
    await expect(mount({ workspaceRoot: 'relative/root' })).rejects.toThrow(
      'workspaceRoot "relative/root" must be an absolute path the composed shell can carry unquoted',
    )
    await expect(mount({ workspaceRoot: '/tmp/a b' })).rejects.toThrow(
      expect.objectContaining<Partial<ProgramError>>({ code: 'PROGRAM_INVALID_CONFIG' }),
    )
  })

  it('refuses a branch prefix that is not git ref components', async () => {
    await expect(mount({ branchPrefix: 'Program/Main' })).rejects.toThrow(
      'branchPrefix "Program/Main" must be lower-kebab-case git ref components',
    )
  })
})

describe('starting a program', () => {
  it('refuses a base revision the shell cannot carry unquoted', async () => {
    const harness = await mount({}, { script: passing })
    await expect(harness.programs.start(spec([goal()], { baseRevision: 'main@{yesterday}' })))
      .rejects.toThrow('baseRevision "main@{yesterday}" is not a revision the composed shell can carry unquoted')
  })

  it('refuses a start whose program session carries no matching spec-freeze signature', async () => {
    const harness = await mount({ requireSignoff: true }, { script: passing })
    await expect(harness.programs.start(spec())).rejects.toThrow(
      expect.objectContaining<Partial<ProgramError>>({ code: 'PROGRAM_SIGNOFF_REQUIRED' }),
    )
    await expect(harness.programs.start(spec())).rejects.toThrow(
      'the spec names no artefact for one to attest',
    )
    const unsigned = spec([goal()], { signoff: { artefactSha256: ARTEFACT } })
    await expect(harness.programs.start(unsigned)).rejects.toThrow(
      'this deployment requires a "spec-freeze" signoff/recorded on the program session before a program may start',
    )
  })

  it('refuses a start whose spec-freeze signature attests another artefact', async () => {
    const harness = await mount({ requireSignoff: true }, { script: passing })
    const signed = spec([goal()], { signoff: { artefactSha256: ARTEFACT } })
    await harness.sign(signed, [{ transition: 'spec-freeze', artefactSha256: OTHER_ARTEFACT }])
    await expect(harness.programs.start(signed)).rejects.toThrow(
      `the "spec-freeze" signoff/recorded attests artefact ${OTHER_ARTEFACT}, which is not the spec's ${ARTEFACT}`,
    )
  })

  it('runs a signed program to release and keeps the caller-signed session log', async () => {
    const harness = await mount({ requireSignoff: true }, { script: passing })
    const signed = spec([goal()], { signoff: { artefactSha256: ARTEFACT } })
    await harness.sign(signed, [
      { transition: 'spec-freeze', artefactSha256: ARTEFACT },
      { transition: 'release', artefactSha256: ARTEFACT },
    ])
    const report = await harness.programs.start(signed)
    expect(report.outcome).toBe('released')
    // The program continued the caller's session rather than replacing it: both
    // signatures still precede the ledger the program wrote into the same log.
    const types = await ledgerTypes(harness, report.sessionId)
    expect(types.filter(type => type === 'signoff/recorded')).toHaveLength(2)
    expect(types.indexOf('program/start')).toBeGreaterThan(types.lastIndexOf('signoff/recorded'))
  })

  it('refuses a release whose program session carries no release signature', async () => {
    const harness = await mount({ requireSignoff: true }, { script: passing })
    const signed = spec([goal()], { signoff: { artefactSha256: ARTEFACT } })
    await harness.sign(signed, [{ transition: 'spec-freeze', artefactSha256: ARTEFACT }])
    await expect(harness.programs.start(signed)).rejects.toThrow(
      'this deployment requires a "release" signoff/recorded on the program session before a program may release',
    )
  })

  it('refuses a preset the roster does not supply or does not compose as an implementer', async () => {
    const unknown = await mount({}, { presets: [], script: passing })
    await expect(unknown.programs.start(spec())).rejects.toThrow(
      'goal "api" names preset "implementing", which no configured root supplies',
    )
    const validator = await mount({}, {
      presets: [{ ...implementerPreset('implementing'), role: 'validator' }],
      script: passing,
    })
    await expect(validator.programs.start(spec())).rejects.toThrow(
      'names preset "implementing", which declares role "validator" rather than implementer',
    )
    const unrestricted = await mount({}, {
      presets: [{ id: 'implementing', trust: 'system', path: '/presets/implementing/agent.cordis.yml' }],
      script: passing,
    })
    await expect(unrestricted.programs.start(spec())).rejects.toThrow(
      'declares role "unrestricted" rather than implementer',
    )
  })

  it('records every goal pending, runs them in dependency order, and releases', async () => {
    const harness = await mount({}, {
      presets: [implementerPreset('implementing'), implementerPreset('documenting')],
      script: passing,
    })
    const program = spec([goal(), goal({ key: 'docs', preset: 'documenting', dependsOn: ['api'] })])
    const report = await harness.programs.start(program)
    expect(report.outcome).toBe('released')
    expect(report.mergedRevision).toBe('headsha')
    expect(report.goals).toEqual([
      { key: 'api', status: 'merged', sessionId: `${report.programId}-api`, revision: 'headsha' },
      { key: 'docs', status: 'merged', sessionId: `${report.programId}-docs`, revision: 'headsha' },
    ])
    expect(await statuses(harness, report.sessionId, 'api')).toEqual(['pending', 'running', 'certified', 'merged'])
    expect(await statuses(harness, report.sessionId, 'docs')).toEqual(['pending', 'running', 'certified', 'merged'])
    // The dependent department's worktree is only added once the first one certified.
    const worktrees = harness.commands.filter(command => command.includes('worktree add'))
    expect(worktrees).toHaveLength(3)
    expect(worktrees[0]).toContain(`${report.programId}/api`)
    expect(worktrees[1]).toContain(`${report.programId}/docs`)
    expect(worktrees[2]).toContain(`${report.programId}/@integration`)
    expect(harness.commands.filter(command => command.startsWith('git merge'))).toEqual([
      `git merge --no-ff -m program/${report.programId}/api program/${report.programId}/api`,
      `git merge --no-ff -m program/${report.programId}/docs program/${report.programId}/docs`,
    ])
  })

  it('stamps each department session with its program, its caps, and its goal', async () => {
    const harness = await mount({}, { script: passing })
    const report = await harness.programs.start(spec())
    const { events } = await harness.ctx.sessionPersistence.inspect(`${report.programId}-api` as SessionId)
    expect(events.filter((event: SessionEvent) => event.type === 'program/member').map(event => event.data))
      .toEqual([{ programId: report.programId, key: 'api' }])
    expect(events.filter((event: SessionEvent) => event.type === 'budget/caps').map(event => event.data))
      .toEqual([{ maxTotalTokens: 1_000 }])
    expect(events.some((event: SessionEvent) => event.type === 'verification/certificate')).toBe(true)
  })

  it('reports a program whose ledger already closed instead of starting it again', async () => {
    const harness = await mount({}, { script: passing })
    const first = await harness.programs.start(spec())
    const commands = harness.commands.length
    const second = await harness.programs.start(spec())
    expect(second).toEqual(first)
    expect(harness.commands).toHaveLength(commands)
  })
})

describe('a department that cannot certify', () => {
  it('fails a goal whose worktree cannot be created, and abandons what depended on it', async () => {
    const harness = await mount({}, {
      script: command => (command.includes('worktree add') ? { exitCode: 128, stderr: 'fatal: no' } : passing(command)),
    })
    const report = await harness.programs.start(spec([goal(), goal({ key: 'docs', dependsOn: ['api'] })]))
    expect(report.outcome).toBe('failed')
    expect(report.goals.map(entry => entry.status)).toEqual(['failed', 'abandoned'])
    expect(report.goals[0]?.reason).toContain('git worktree add')
    expect(report.goals[0]?.reason).toContain('exit 128')
    expect(await ledgerTypes(harness, report.sessionId)).toEqual([
      'program/start', 'program/goal', 'program/goal', 'program/goal', 'program/goal', 'program/end',
    ])
  })

  it('fails a goal whose checks never pass, spending exactly the configured rounds', async () => {
    const harness = await mount({ maxGoalRounds: 2 }, { script: failing('check-api') })
    const report = await harness.programs.start(spec())
    expect(report.goals[0]).toMatchObject({ status: 'failed', reason: 'no certificate after 2 rounds' })
    expect(harness.commands.filter(command => command === 'check-api')).toHaveLength(2)
  })

  it('blocks a goal its own session blocked, and never starts what depends on it', async () => {
    const harness = await mount({}, { script: failing('check-api') })
    harness.turn = (agent: Agent) => {
      const current = harness.ctx.goals.get(agent)
      if (current === undefined) return
      harness.ctx.goals.block(agent, { id: current.id, revision: current.revision }, {
        code: 'budget-exhausted',
        message: 'the department spent its caps',
      })
    }
    const report = await harness.programs.start(spec([goal(), goal({ key: 'docs', dependsOn: ['api'] })]))
    expect(report.goals.map(entry => [entry.status, entry.reason])).toEqual([
      ['blocked', 'budget-exhausted'],
      ['abandoned', 'the program ended before this goal started'],
    ])
    expect(report.outcome).toBe('failed')
  })

  it('fails a goal whose checks the verification domain refuses to author', async () => {
    const harness = await mount({}, { script: passing })
    const report = await harness.programs.start(spec([goal({
      checks: [{ id: 'API_Builds' as CheckId, outcome: 'the api builds', run: 'check-api' }],
    })]))
    expect(report.goals[0]?.status).toBe('failed')
    expect(report.goals[0]?.reason).toContain('check id "API_Builds" must be lower-kebab-case')
  })

  it('fails a run whose claimed isolation the session cannot prove', async () => {
    const harness = await mount({}, { script: passing })
    const report = await harness.programs.start(spec([goal({ isolation: 'host' })]))
    expect(report.goals[0]?.status).toBe('failed')
    expect(report.goals[0]?.reason).toContain('run cannot claim "host" isolation')
  })
})

describe('the integration over the merged head', () => {
  it('fails the program when a department branch does not merge', async () => {
    const script = (command: string): ScriptedRun =>
      (command.startsWith('git merge') ? { exitCode: 1, stderr: 'CONFLICT' } : passing(command))
    const conflicted = await mount({}, { script })
    const report = await conflicted.programs.start(spec())
    expect(report.outcome).toBe('failed')
    expect(report.goals[0]?.status).toBe('certified')
    const { events } = await conflicted.ctx.sessionPersistence.inspect(report.sessionId)
    const integration = events.filter((event: SessionEvent) => event.type === 'program/integration')
    expect(integration.map(event => event.data)).toMatchObject([
      { status: 'running' },
      { status: 'failed', reason: expect.stringContaining('CONFLICT') as unknown },
    ])
  })

  it('fails the program when the merged head does not pass the integration standard', async () => {
    const harness = await mount({}, { script: failing('check-merged') })
    const report = await harness.programs.start(spec())
    expect(report.outcome).toBe('failed')
    expect(report.mergedRevision).toBeUndefined()
    const { events } = await harness.ctx.sessionPersistence.inspect(report.sessionId)
    expect(events.filter((event: SessionEvent) => event.type === 'program/integration').at(-1)?.data)
      .toMatchObject({ status: 'failed', reason: 'the merged head did not pass the integration standard' })
  })

  it('certifies a merged head without a model turn and runs every gate as a check', async () => {
    const harness = await mount({}, { script: passing })
    const turns: string[] = []
    harness.turn = (agent: Agent) => { turns.push(agent.id) }
    const report = await harness.programs.start(spec([goal()], {
      integration: { checks: [], gates: ['run-lint', 'run-test'] },
    }))
    expect(report.outcome).toBe('released')
    expect(harness.commands).toContain('run-lint')
    expect(harness.commands).toContain('run-test')
    // The department takes one turn; the integration takes none.
    expect(turns).toEqual([`${report.programId}-api`])
  })
})

/** One department a killed process left behind, as the next one finds it. */
interface SeedDepartment {
  readonly key: string
  /** Whether the department's own log carries a certificate. */
  certified?: boolean
  /** Whether the department's worktree still exists; a directory alone when `session` is false. */
  worktree?: boolean
  /** Whether a department session exists at all. */
  session?: boolean
  /** Whether that session carries a goal. */
  goal?: boolean
  /** Whether that session carries an authored standard. */
  standard?: boolean
  /** Whether the department's goal is blocked. */
  blocked?: boolean
}

/** What one seeded ledger records beyond its own start. */
interface SeedOptions {
  /** Whether the ledger declares every goal of the spec pending. */
  pending?: boolean
  /** Whether the ledger records a certified integration over its running one. */
  integration?: 'running' | 'certified'
  /** A closing record, making the seeded ledger a finished one. */
  end?: { outcome: 'released' | 'failed'; mergedRevision?: string }
}

/** One persisted program a process left open, plus the roots it lives in. */
interface SeededProgram {
  readonly sessions: string
  readonly root: string
  readonly programId: string
}

/**
 * Write the durable state a killed process leaves behind: a ledger, one
 * department session per key it created, and the worktrees those departments
 * own. The seeding harness waits for a Loader that never settles, so its own
 * reconciliation never observes the state being written for the next process.
 */
async function seedProgram(
  program: ProgramSpec,
  departments: readonly SeedDepartment[] = [],
  options: SeedOptions = {},
  shared: { sessions?: string; root?: string } = {},
): Promise<SeededProgram> {
  const sessions = shared.sessions ?? mkdtempSync(join(tmpdir(), 'program-sessions-'))
  const root = shared.root ?? mkdtempSync(join(tmpdir(), 'program-root-'))
  if (shared.sessions === undefined) roots.push(sessions)
  if (shared.root === undefined) roots.push(root)
  const frozen = resolveProgramSpec(program)
  const programId = programIdFor(programSpecDigest(frozen))
  const seeder = await mount({}, {
    sessions,
    root,
    script: passing,
    loader: { await: () => new Promise<void>(() => {}) },
  })

  const ledger = seeder.ctx.sessions.create(SessionId(programId), { meta: { cwd: root } })
  ledger.append('program/start', {
    programId,
    specSha256: programSpecDigest(frozen),
    spec: frozen,
    baseRevision: frozen.baseRevision,
  })
  if (options.pending !== false) {
    for (const entry of frozen.goals) {
      ledger.append('program/goal', { programId, key: entry.key, status: 'pending' })
    }
  }
  for (const department of departments) {
    const sessionId = `${programId}-${department.key}` as SessionId
    const workspace = join(root, programId, department.key)
    if (department.worktree !== false) mkdirSync(workspace, { recursive: true })
    if (department.session === false) continue
    ledger.append('program/goal', { programId, key: department.key, status: 'running', sessionId, workspace })
    const goalSpec = frozen.goals.find(entry => entry.key === department.key) as ProgramGoalSpec
    const session = seeder.ctx.sessions.create(sessionId, { meta: { cwd: workspace } })
    const agent = stubAgent(session)
    const unregister = seeder.ctx.agents.register(agent)
    session.append('program/member', { programId, key: department.key })
    if (department.goal !== false) {
      const created = seeder.ctx.goals.create(agent, { objective: goalSpec.objective, maxGoalRounds: 2 })
      seeder.ctx.goals.disarm(agent)
      if (department.blocked === true) {
        seeder.ctx.goals.block(agent, { id: created.id, revision: created.revision }, {
          code: 'budget-exhausted',
          message: 'the department spent its caps',
        })
      } else if (department.standard !== false) {
        const standard = seeder.ctx.completionStandards.author(agent, { goalId: created.id, checks: goalSpec.checks })
        if (department.certified === true) {
          seeder.ctx.completionStandards.recordRun(agent, { id: standard.id, revision: standard.revision }, 'none',
            goalSpec.checks.map(check => ({ checkId: check.id, status: 'pass' as const, evidence: 'exit 0' })),
            { executor: 'runner' })
          seeder.ctx.goals.complete(agent, { id: created.id, revision: created.revision })
        }
      }
    }
    await seeder.ctx.sessions.flush(session)
    unregister()
  }
  if (options.integration !== undefined) {
    ledger.append('program/integration', { programId, status: 'running' })
    if (options.integration === 'certified') {
      ledger.append('program/integration', { programId, status: 'certified' })
    }
  }
  if (options.end !== undefined) ledger.append('program/end', { programId, ...options.end })
  await seeder.ctx.sessions.flush(ledger)
  await seeder.dispose()
  harnesses.splice(harnesses.indexOf(seeder), 1)
  return { sessions, root, programId }
}

describe('reconciling a program a process left open', () => {
  it('reads a certified department from its own log, starts only what never ran, and releases', async () => {
    const program = spec([goal(), goal({ key: 'docs', dependsOn: ['api'] })])
    const seeded = await seedProgram(program, [{ key: 'api', certified: true }])

    const second = await mount({}, { sessions: seeded.sessions, root: seeded.root, script: passing })
    const report = await second.programs.start(program)
    expect(report.outcome).toBe('released')
    expect(await statuses(second, report.sessionId, 'api')).toEqual(['pending', 'running', 'certified', 'merged'])
    expect(await statuses(second, report.sessionId, 'docs')).toEqual(['pending', 'running', 'certified', 'merged'])
    const { events } = await second.ctx.sessionPersistence.inspect(report.sessionId)
    expect(events.filter((event: SessionEvent) => event.type === 'program/resume').map(event => event.data))
      .toMatchObject([{ statuses: { certified: 1, pending: 1, running: 0 } }])
    // The department that already certified is never given a second session.
    expect(second.commands.filter(command => command.includes(`worktree add -B program/${seeded.programId}/api`)))
      .toHaveLength(0)
  })

  it('fails a department whose worktree is gone while its session remains', async () => {
    const program = spec([goal()])
    const seeded = await seedProgram(program, [{ key: 'api', worktree: false }])

    const second = await mount({}, { sessions: seeded.sessions, root: seeded.root, script: passing })
    const report = await second.programs.start(program)
    expect(report.goals[0]).toMatchObject({ status: 'failed' })
    expect(report.goals[0]?.reason).toContain('is gone, so nothing can show what this department delivered')
    expect(report.outcome).toBe('failed')
  })

  it('resumes a department whose goal is still active and drives it to a certificate', async () => {
    const program = spec([goal()])
    const seeded = await seedProgram(program, [{ key: 'api' }])

    // The department's own goal is still active, so the later process resumes
    // it in place rather than creating a second session for the key.
    const second = await mount({}, { sessions: seeded.sessions, root: seeded.root, script: passing })
    const report = await second.programs.start(program)
    expect(report.outcome).toBe('released')
    expect(second.commands.filter(command => command.includes('worktree add'))).toHaveLength(1)
    expect(await statuses(second, report.sessionId, 'api')).toEqual(['pending', 'running', 'certified', 'merged'])
  })

  it('records a blocked department and waits for an operator instead of driving it', async () => {
    const program = spec([goal(), goal({ key: 'docs', dependsOn: ['api'] })])
    const seeded = await seedProgram(program, [{ key: 'api', blocked: true }])

    const second = await mount({}, { sessions: seeded.sessions, root: seeded.root, script: passing })
    const report = await second.programs.start(program)
    expect(report.goals.map(entry => [entry.status, entry.reason])).toEqual([
      ['blocked', 'budget-exhausted'],
      ['abandoned', 'the program ended before this goal started'],
    ])
    expect(second.commands.filter(command => command.includes('worktree add'))).toHaveLength(0)
  })

  it('fails a resumed department whose session carries no goal, and one that carries no standard', async () => {
    const noGoal = await seedProgram(spec([goal()]), [{ key: 'api', goal: false }])
    const first = await mount({}, { sessions: noGoal.sessions, root: noGoal.root, script: passing })
    const failed = await first.programs.start(spec([goal()]))
    expect(failed.goals[0]).toMatchObject({ status: 'failed', reason: 'the department session carries no goal' })

    const noStandard = await seedProgram(spec([goal()]), [{ key: 'api', standard: false }])
    const second = await mount({}, { sessions: noStandard.sessions, root: noStandard.root, script: passing })
    const unmeasured = await second.programs.start(spec([goal()]))
    expect(unmeasured.goals[0]).toMatchObject({ status: 'failed', reason: 'no certificate after 2 rounds' })
  })

  it('declares a goal the ledger never recorded, and reuses a worktree whose session was never durable', async () => {
    const program = spec([goal()])
    // The killed process created the worktree and died before the ledger or the
    // department session recorded anything about it.
    const seeded = await seedProgram(program, [{ key: 'api', session: false }], { pending: false })

    const second = await mount({}, { sessions: seeded.sessions, root: seeded.root, script: passing })
    const report = await second.programs.start(program)
    expect(report.outcome).toBe('released')
    expect(await statuses(second, report.sessionId, 'api')).toEqual(['pending', 'running', 'certified', 'merged'])
    expect(second.commands.filter(command => command.includes(`worktree add -B program/${seeded.programId}/api`)))
      .toHaveLength(0)
  })

  it('merges every goal of a program whose integration already certified, and releases it', async () => {
    const program = spec([goal()])
    const seeded = await seedProgram(program, [{ key: 'api', certified: true }], { integration: 'certified' })

    const second = await mount({}, { sessions: seeded.sessions, root: seeded.root, script: passing })
    const report = await second.programs.start(program)
    expect(report.outcome).toBe('released')
    expect(report.mergedRevision).toBeUndefined()
    expect(await statuses(second, report.sessionId, 'api')).toEqual(['pending', 'running', 'certified', 'merged'])
  })

  it('refuses to release a program a later deployment requires a signoff for', async () => {
    const program = spec([goal()])
    const seeded = await seedProgram(program, [{ key: 'api', certified: true }], { integration: 'certified' })

    const strict = await mount({ requireSignoff: true }, {
      sessions: seeded.sessions,
      root: seeded.root,
      script: passing,
      loader: { await: () => new Promise<void>(() => {}) },
    })
    await expect(strict.programs.resume()).rejects.toThrow(
      'this deployment requires a signoff record before a program may release, and the spec names no artefact for one to attest',
    )
  })

  it('picks an open ledger up from a start over a reconciliation that has not run yet', async () => {
    const program = spec([goal()])
    const seeded = await seedProgram(program, [{ key: 'api', certified: true }])

    // The service's own reconciliation waits for a Loader that never settles,
    // so this start is what reads the open ledger.
    const second = await mount({}, {
      sessions: seeded.sessions,
      root: seeded.root,
      script: passing,
      loader: { await: () => new Promise<void>(() => {}) },
    })
    const report = await second.programs.start(program)
    expect(report.outcome).toBe('released')
  })

  it('reports a finished ledger that never recorded one of its goals', async () => {
    const program = spec([goal()])
    const seeded = await seedProgram(program, [], { pending: false, end: { outcome: 'failed' } })

    const second = await mount({}, { sessions: seeded.sessions, root: seeded.root, script: passing })
    const report = await second.programs.start(program)
    expect(report).toEqual({
      programId: seeded.programId,
      sessionId: seeded.programId,
      outcome: 'failed',
      goals: [{ key: 'api', status: 'pending' }],
    })
  })

  it('skips a program whose ledger already carries its closing record', async () => {
    const sessions = mkdtempSync(join(tmpdir(), 'program-sessions-'))
    const root = mkdtempSync(join(tmpdir(), 'program-root-'))
    roots.push(sessions, root)
    const first = await mount({}, { sessions, root, script: passing })
    await first.programs.start(spec())
    await first.dispose()
    harnesses.splice(harnesses.indexOf(first), 1)

    const second = await mount({}, { sessions, root, script: passing })
    await expect(second.programs.resume()).resolves.toEqual([])
  })

  it('reads a session that belongs to no program at all', async () => {
    const harness = await mount({}, { script: passing })
    harness.ctx.sessions.create('unrelated' as SessionId).append('turn/start', { turn: 1 })
    await expect(harness.programs.resume()).resolves.toEqual([])
  })
})

describe('the program token ceiling', () => {
  it('abandons the goals a program cannot afford to start', async () => {
    const harness = await mount({}, { script: passing })
    harness.turn = (agent: Agent) => {
      agent.session.append('assistant/message', {
        turn: 1,
        step: 1,
        message: {
          id: 'message-1',
          role: 'assistant',
          content: [{ type: 'text', text: 'done' }],
          source: { kind: 'assistant', provider: 'cli-mock', model: 'cli-mock' },
        },
        usage: { inputTokens: 30, outputTokens: 30 },
      } as never, { surfaceOp: 'append' })
    }
    const report = await harness.programs.start(spec([goal(), goal({ key: 'docs', dependsOn: ['api'] })], {
      tokenCeiling: 50,
    }))
    expect(report.goals.map(entry => entry.status)).toEqual(['certified', 'abandoned'])
    expect(report.outcome).toBe('abandoned')
  })
})

describe('what a failing check records', () => {
  it('bounds the evidence it keeps and states how a command died', async () => {
    const harness = await mount({ evidenceMaxChars: 24, maxGoalRounds: 1 }, {
      script: command => (command === 'check-api'
        ? { exitCode: null, signal: 'SIGKILL', stdout: 'x'.repeat(200) }
        : passing(command)),
    })
    const report = await harness.programs.start(spec())
    expect(report.goals[0]?.status).toBe('failed')
    const { events } = await harness.ctx.sessionPersistence.inspect(`${report.programId}-api` as SessionId)
    const evidence = recordedEvidence(events)
    expect(evidence).toHaveLength(24)
    expect(evidence.startsWith('…')).toBe(true)
  })

  it('names an unknown signal when a command died without one, and reports a silent exit', async () => {
    const harness = await mount({ maxGoalRounds: 1 }, {
      script: command => (command === 'check-api' ? { exitCode: null } : passing(command)),
    })
    const report = await harness.programs.start(spec())
    const { events } = await harness.ctx.sessionPersistence.inspect(`${report.programId}-api` as SessionId)
    expect(recordedEvidence(events)).toBe('terminated by an unknown signal')
  })
})

describe('bounding the departments in flight', () => {
  it('never runs more departments at once than the deployment allows', async () => {
    const inFlight: string[] = []
    let peak = 0
    const harness = await mount({ maxConcurrentGoals: 1 }, {
      presets: [implementerPreset('implementing')],
      script: passing,
    })
    harness.turn = (agent: Agent) => {
      inFlight.push(agent.id)
      peak = Math.max(peak, inFlight.length)
      inFlight.pop()
    }
    const report = await harness.programs.start(spec([goal(), goal({ key: 'docs' }), goal({ key: 'ui' })]))
    expect(report.outcome).toBe('released')
    expect(peak).toBe(1)
  })
})

describe('a certificate whose goal the session dropped', () => {
  it('records the department certified without completing a goal that is gone', async () => {
    const harness = await mount({}, { script: passing })
    harness.turn = (agent: Agent) => {
      const current = harness.ctx.goals.get(agent)
      if (current === undefined) return
      harness.ctx.goals.clear(agent, { id: current.id, revision: current.revision })
    }
    const report = await harness.programs.start(spec())
    expect(report.outcome).toBe('released')
    expect(report.goals[0]?.status).toBe('merged')
    const { events } = await harness.ctx.sessionPersistence.inspect(`${report.programId}-api` as SessionId)
    expect(events.filter((event: SessionEvent) => event.type === 'goal/change')
      .map(event => (event.data as { operation: string }).operation)).toEqual(['create', 'clear'])
    expect(events.some((event: SessionEvent) => event.type === 'verification/certificate')).toBe(true)
  })
})

describe('an integration that cannot start', () => {
  it('records the integration failed when its worktree cannot be created', async () => {
    const harness = await mount({}, {
      script: command => (command.includes('@integration') ? { exitCode: 128, stderr: 'fatal: no' } : passing(command)),
    })
    const report = await harness.programs.start(spec())
    expect(report.outcome).toBe('failed')
    const { events } = await harness.ctx.sessionPersistence.inspect(report.sessionId)
    expect(events.filter((event: SessionEvent) => event.type === 'program/integration').map(event => event.data))
      .toMatchObject([{ status: 'failed', reason: expect.stringContaining('exit 128') as unknown }])
  })
})

describe('service lifecycle', () => {
  it('stops starting departments and picking up programs once its fiber unloads', async () => {
    const sessions = mkdtempSync(join(tmpdir(), 'program-sessions-'))
    const root = mkdtempSync(join(tmpdir(), 'program-root-'))
    roots.push(sessions, root)
    await seedProgram(spec([goal()], { objective: 'ship the first release' }), [], {}, { sessions, root })
    await seedProgram(spec([goal()], { objective: 'ship the second release' }), [], {}, { sessions, root })

    let unloading: Promise<void> | undefined
    const harness = await mount({}, {
      sessions,
      root,
      loader: { await: () => new Promise<void>(() => {}) },
      script: async (command) => {
        if (unloading === undefined && command.includes('worktree add')) {
          unloading = harness.unload()
          // The unload refuses further work as it disposes; answering only
          // afterwards is what puts this pass on the stopping path.
          await new Promise<void>((resolve) => { setTimeout(resolve, 50) })
        }
        return passing(command)
      },
    })
    const reports = await harness.programs.resume()
    await unloading
    harnesses.splice(harnesses.indexOf(harness), 1)
    // The pass reports the program it had already picked up, without a closing
    // record, and never reaches the second one.
    expect(reports).toHaveLength(1)
    expect(reports[0]?.outcome).toBeUndefined()
  })


  it('reconciles once over a settled application and logs a failure instead of taking the process down', async () => {
    const ctx = new Context()
    const error = vi.fn()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    ctx.provide('sessionPersistence', { list: () => Promise.reject(new Error('backend down')) } as never)
    ctx.provide('agentDefaultModel', {} as never)
    ctx.provide('agentPresets', {} as never)
    ctx.provide('completionStandards', {} as never)
    ctx.provide('goals', {} as never)
    ctx.provide('shell', {} as never)
    Object.defineProperty(ctx, 'logger', { value: { error, warn: () => {} }, configurable: true })
    const root = mkdtempSync(join(tmpdir(), 'program-root-'))
    roots.push(root)
    await ctx.plugin(ProgramService, {
      workspaceRoot: root,
      requireSignoff: false,
      maxConcurrentGoals: 1,
      maxGoalRounds: 1,
      branchPrefix: 'program',
      evidenceMaxChars: 64,
    })
    await expect(ctx.programs.resume()).rejects.toThrow('backend down')
    expect(error).toHaveBeenCalledWith(expect.stringContaining('the program service did not reconcile at start'))
    await ctx.fiber.dispose()
  })

  it('serializes passes and settles the one in flight when the fiber unloads', async () => {
    const harness = await mount({}, { script: passing })
    const started = harness.programs.start(spec())
    const resumed = harness.programs.resume()
    await expect(started).resolves.toMatchObject({ outcome: 'released' })
    await expect(resumed).resolves.toEqual([])
    await harness.dispose()
    harnesses.splice(harnesses.indexOf(harness), 1)
  })
})
