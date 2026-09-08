/**
 * Departments staffed by an external coding agent, over a stubbed subagent
 * seam: what one attempt delegates and records, what the round cap buys, what a
 * missing provider or an unsupportable isolation refuses, what the route
 * default still does, and what a restart makes of a delegated attempt that
 * already ended.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import type { CheckId } from '@deepseek-ai/dsh-verification/types'
import { programIdFor, programSpecDigest, resolveProgramSpec } from '@deepseek-ai/dsh-program'
import type { ProgramDelegation, ProgramGoalSpec, ProgramSpec } from '@deepseek-ai/dsh-program'
import {
  IN_PROCESS_CAPABILITIES,
  OUT_OF_PROCESS_CAPABILITIES,
  programHarness,
  stubAgent,
  type ProgramHarness,
  type ScriptedRun,
  type StubbedProvider,
} from './harness.ts'

const harnesses: ProgramHarness[] = []
const roots: string[] = []

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

/** One well-formed spec of one goal, staffed however the caller states. */
function programSpec(overrides: Partial<ProgramSpec> = {}): ProgramSpec {
  return {
    objective: 'ship the release',
    baseRevision: 'base',
    goals: [goal()],
    integration: {
      checks: [{ id: 'merged-builds' as CheckId, outcome: 'the merged head builds', run: 'check-merged' }],
      gates: [],
    },
    ...overrides,
  }
}

/** The same spec, delegating its departments to the named provider. */
function delegated(provider: string, overrides: Partial<ProgramSpec> = {}, label?: string): ProgramSpec {
  return programSpec({
    implementer: { kind: 'subagent', provider, ...label === undefined ? {} : { label } },
    ...overrides,
  })
}

/**
 * The default script: every worktree is clean at the same commit, no branch is
 * merged into the integration worktree yet, and every command succeeds.
 */
function passing(command: string): ScriptedRun {
  if (command === 'git rev-parse HEAD^{tree}') return { stdout: 'treesha\n' }
  if (command.startsWith('git rev-parse')) return { stdout: 'headsha\n' }
  if (command.startsWith('git merge-base')) return { exitCode: 1 }
  return {}
}

/** A script that fails the named check command and passes everything else. */
function failing(failed: string): (command: string) => ScriptedRun {
  return command => (command === failed ? { exitCode: 1, stderr: 'no' } : passing(command))
}

/** An in-process provider that completes every run without touching the tree. */
const inProcess: StubbedProvider = { name: 'spawn', capabilities: IN_PROCESS_CAPABILITIES, localTokens: 60 }

/** An out-of-process provider, which publishes no local child and honors no start-time capability. */
const outOfProcess: StubbedProvider = { name: 'claude-code', capabilities: OUT_OF_PROCESS_CAPABILITIES }

/** Every delegation one department's log recorded, in log order. */
async function delegations(harness: ProgramHarness, sessionId: string): Promise<ProgramDelegation[]> {
  const { events } = await harness.ctx.sessionPersistence.inspect(sessionId as SessionId)
  return events
    .filter((event): event is SessionEvent<'program/delegation'> => event.type === 'program/delegation')
    .map(event => event.data)
}

describe('a department delegated to an external coding agent', () => {
  it('delegates the goal text once, records the run, and certifies on the tree it left', async () => {
    const harness = await mount({}, { script: passing, subagents: [{ ...inProcess, localTokens: 42 }] })
    const report = await harness.programs.start(delegated('spawn', {}, 'external'))

    expect(report.outcome).toBe('released')
    expect(report.goals[0]).toMatchObject({ status: 'merged', revision: 'headsha' })
    // The department itself never took a turn: the child did the work, in the
    // department worktree the provider derives from its parent session.
    expect(harness.starts).toMatchObject([{
      provider: 'spawn',
      prompt: 'deliver the api',
      parentCwd: join(harness.root, report.programId, 'api'),
      label: 'external',
      disposed: true,
    }])
    expect(harness.starts[0]?.signal.aborted).toBe(false)
    expect(await delegations(harness, `${report.programId}-api`)).toEqual([{
      goalKey: 'api',
      attempt: 1,
      provider: 'spawn',
      runId: 'child-spawn-1',
      stopReason: 'completed',
      usage: { totalTokens: 42 },
    }])
    // The checks the program ran are what the certificate cites.
    expect(harness.commands.filter(command => command === 'check-api')).toHaveLength(1)
  })

  it('carries the check-failure text into the next attempt and stops at the round cap', async () => {
    const harness = await mount({ maxGoalRounds: 3 }, {
      script: failing('check-api'),
      subagents: [inProcess],
    })
    const report = await harness.programs.start(delegated('spawn'))

    expect(report.goals[0]).toMatchObject({ status: 'failed', reason: 'no certificate after 3 rounds' })
    expect(harness.starts).toHaveLength(3)
    expect(harness.starts[0]?.prompt).toBe('deliver the api')
    for (const start of harness.starts.slice(1)) {
      expect(start.prompt).toContain('<checks_failed>')
      expect(start.prompt).toContain('api-builds: exit 1')
    }
    expect((await delegations(harness, `${report.programId}-api`)).map(record => record.attempt)).toEqual([1, 2, 3])
  })

  it('records what a run that did not complete came to, and certifies anyway when the tree passes', async () => {
    const run = (): SubagentResult => ({ output: [], stopReason: 'error' })
    // No `localTokens`: this run publishes no child, so the record states no usage.
    const harness = await mount({}, { script: passing, subagents: [{ name: 'spawn', capabilities: IN_PROCESS_CAPABILITIES, run }] })
    const report = await harness.programs.start(delegated('spawn'))

    expect(report.outcome).toBe('released')
    const recorded = await delegations(harness, `${report.programId}-api`)
    expect(recorded).toEqual([{
      goalKey: 'api',
      attempt: 1,
      provider: 'spawn',
      runId: 'run-spawn-1',
      stopReason: 'error',
    }])
  })

  it('records the structured result a provider captured', async () => {
    const run = (): SubagentResult => ({ output: [], stopReason: 'completed', structured: { changed: ['api.ts'] } })
    const harness = await mount({}, { script: passing, subagents: [{ ...inProcess, run }] })
    const report = await harness.programs.start(delegated('spawn'))

    expect((await delegations(harness, `${report.programId}-api`))[0]?.structured).toEqual({ changed: ['api.ts'] })
  })

  it('drives the integration itself, whatever staffs the departments', async () => {
    const turns: string[] = []
    const harness = await mount({}, { script: failing('check-merged'), subagents: [inProcess] })
    harness.turn = (agent) => { turns.push(agent.id) }
    const report = await harness.programs.start(delegated('spawn'))

    expect(report.outcome).toBe('failed')
    // Only the integration session took turns; the delegated department took none.
    expect(new Set(turns)).toEqual(new Set([`${report.programId}-@integration`]))
    expect(harness.starts.map(start => start.provider)).toEqual(['spawn'])
  })
})

describe('staffing a department the deployment cannot supply', () => {
  it('refuses a program whose deployment composes no subagent seam at all', async () => {
    const harness = await mount({}, { script: passing })
    const report = await harness.programs.start(delegated('spawn'))

    expect(report.goals[0]?.status).toBe('failed')
    expect(report.goals[0]?.reason).toContain('the subagent provider "spawn", which this deployment does not compose')
    expect(harness.commands.filter(command => command.includes('worktree add'))).toHaveLength(0)
  })

  it('refuses a program naming a provider the seam does not register', async () => {
    const harness = await mount({}, { script: passing, subagents: [inProcess] })
    const report = await harness.programs.start(delegated('codex'))

    expect(report.goals[0]?.reason).toContain('the subagent provider "codex", which this deployment does not compose')
  })

  it('refuses an isolation above none for an out-of-process provider, and allows it for an in-process one', async () => {
    const refused = await mount({}, { script: passing, subagents: [outOfProcess] })
    const report = await refused.programs.start(delegated('claude-code', { goals: [goal({ isolation: 'process' })] }))
    expect(report.goals[0]?.reason).toContain(
      'goal "api" claims "process" isolation, which no department delegated to the out-of-process provider "claude-code" can support',
    )
    expect(refused.commands.filter(command => command.includes('worktree add'))).toHaveLength(0)

    // An in-process child joins the parent's composition, so the deployment's
    // own isolation claim is the one the verification domain then judges.
    const allowed = await mount({}, { script: passing, subagents: [inProcess] })
    const local = await allowed.programs.start(delegated('spawn', { goals: [goal({ isolation: 'process' })] }))
    expect(local.goals[0]?.reason).toContain('run cannot claim "process" isolation')
    expect(allowed.starts).toHaveLength(1)
  })

  it('lets an out-of-process provider staff a department claiming no isolation', async () => {
    const harness = await mount({}, { script: passing, subagents: [outOfProcess] })
    const report = await harness.programs.start(delegated('claude-code'))

    expect(report.outcome).toBe('released')
    // Nothing in this process published the child, so nothing states what it cost.
    expect((await delegations(harness, `${report.programId}-api`))[0]?.usage).toBeUndefined()
  })
})

describe('the route default', () => {
  it('drives the department itself when the spec states no implementer', async () => {
    const turns: string[] = []
    const harness = await mount({}, { script: passing, subagents: [inProcess] })
    harness.turn = (agent) => { turns.push(agent.id) }
    const report = await harness.programs.start(programSpec())

    expect(report.outcome).toBe('released')
    expect(turns).toEqual([`${report.programId}-api`])
    expect(harness.starts).toEqual([])
  })

  it('gives a program staffed two ways two identities', () => {
    const digestOf = (spec: ProgramSpec): string => programSpecDigest(resolveProgramSpec(spec))
    const route = digestOf(programSpec())
    expect(digestOf(programSpec({ implementer: { kind: 'route' } }))).toBe(route)
    expect(digestOf(delegated('spawn'))).not.toBe(route)
    expect(digestOf(delegated('claude-code'))).not.toBe(digestOf(delegated('spawn')))
    expect(digestOf(delegated('spawn', {}, 'external'))).not.toBe(digestOf(delegated('spawn')))
  })
})

describe('reconciling a delegated department a process left open', () => {
  it('continues after the attempt its log records rather than running it again', async () => {
    const sessions = mkdtempSync(join(tmpdir(), 'program-sessions-'))
    const root = mkdtempSync(join(tmpdir(), 'program-root-'))
    roots.push(sessions, root)

    const program = delegated('spawn')
    const frozen = resolveProgramSpec(program)
    const programId = programIdFor(programSpecDigest(frozen))

    // A killed process left a running department whose first delegated attempt
    // ended, and a ledger that never recorded anything past `running`.
    const seeder = await mount({}, {
      sessions,
      root,
      script: passing,
      subagents: [inProcess],
      loader: { await: () => new Promise<void>(() => {}) },
    })
    const workspace = join(root, programId, 'api')
    mkdirSync(workspace, { recursive: true })
    const ledger = seeder.ctx.sessions.create(SessionId(programId), { meta: { cwd: root } })
    ledger.append('program/start', {
      programId,
      specSha256: programSpecDigest(frozen),
      spec: frozen,
      baseRevision: frozen.baseRevision,
      implementer: frozen.implementer,
    })
    ledger.append('program/goal', { programId, key: 'api', status: 'pending' })
    ledger.append('program/goal', {
      programId,
      key: 'api',
      status: 'running',
      sessionId: SessionId(`${programId}-api`),
      workspace,
    })
    const department = seeder.ctx.sessions.create(SessionId(`${programId}-api`), { meta: { cwd: workspace } })
    const agent = stubAgent(department)
    const unregister = seeder.ctx.agents.register(agent)
    department.append('program/member', { programId, key: 'api' })
    const created = seeder.ctx.goals.create(agent, { objective: frozen.goals[0]?.objective ?? '', maxGoalRounds: 2 })
    seeder.ctx.goals.disarm(agent)
    seeder.ctx.completionStandards.author(agent, { goalId: created.id, checks: goal().checks })
    department.append('program/delegation', {
      goalKey: 'api',
      attempt: 1,
      provider: 'spawn',
      runId: SessionId('child-spawn-1'),
      stopReason: 'completed',
    })
    await seeder.ctx.sessions.flush(department)
    await seeder.ctx.sessions.flush(ledger)
    unregister()
    await seeder.dispose()
    harnesses.splice(harnesses.indexOf(seeder), 1)

    const second = await mount({ maxGoalRounds: 2 }, { sessions, root, script: passing, subagents: [inProcess] })
    const report = await second.programs.start(program)

    expect(report.outcome).toBe('released')
    // The resumed pass had one attempt left of the cap and used it as attempt 2.
    expect(second.starts).toHaveLength(1)
    expect((await delegations(second, `${programId}-api`)).map(record => record.attempt)).toEqual([1, 2])
  })
})

describe('a delegated program whose service is stopping', () => {
  it('cancels the child it delegates to as the fiber unloads', async () => {
    let unloading: Promise<void> | undefined
    const harness = await mount({}, {
      script: passing,
      subagents: [{
        ...inProcess,
        run: async (): Promise<SubagentResult> => {
          // The unload refuses further work as it disposes; answering only
          // afterwards puts the delegated attempt on the stopping path.
          unloading ??= harness.unload()
          await new Promise<void>((resolve) => { setTimeout(resolve, 50) })
          return { output: [], stopReason: 'aborted' }
        },
      }],
    })
    const report = await harness.programs.start(delegated('spawn'))
    await unloading
    harnesses.splice(harnesses.indexOf(harness), 1)

    // The cancellation the program hands every child is the one its teardown
    // fires, so a child in another process is told to stop rather than waited on.
    expect(harness.starts).toHaveLength(1)
    expect(harness.starts[0]?.signal.aborted).toBe(true)
    // The pass stopped before the program could integrate what it certified.
    expect(report.outcome).toBeUndefined()
    expect(report.goals[0]?.status).toBe('certified')
  })
})
