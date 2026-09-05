import { writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { EnvironmentDefinition, EnvironmentRunStamp } from '@deepseek-ai/dsh-environments'
import { GoalId } from '@deepseek-ai/dsh-goal'
import type { CreateGoalRequest, GoalRef, GoalView } from '@deepseek-ai/dsh-goal'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ShellExecRequest, ShellExecSpec, ShellRunResult } from '@deepseek-ai/dsh-shell'
import { CheckId, StandardId } from '@deepseek-ai/dsh-verification'
import type {
  AuthorStandardRequest,
  CertificateIsolation,
  CheckResult,
  DirectiveRequest,
  RunEvidence,
  RunOutcome,
  StandardRef,
  StandardView,
} from '@deepseek-ai/dsh-verification'
import EnvironmentRunner, { EnvironmentRunError, resolveConfig } from '@deepseek-ai/dsh-environment-runner'
import type { Config, EnvironmentRunReport } from '@deepseek-ai/dsh-environment-runner'
import * as invariantCompanion from '@deepseek-ai/dsh-environment-runner/invariant'

declare module '@deepseek-ai/dsh-environments/types' {
  interface EnvironmentKindMap {
    smoke: Record<string, never>
  }
}

/** The live-agent surface the runner drives, with a log that records what the runner appends. */
class FakeSession {
  readonly events: SessionEvent[] = []
  seq = 0
  constructor(readonly id: SessionId) {}
  append(type: string, data: unknown): SessionEvent {
    const event = { type, seq: this.seq, time: this.seq, data } as unknown as SessionEvent
    this.seq += 1
    this.events.push(event)
    return event
  }
}

class FakeAgent {
  readonly id: SessionId
  readonly session: FakeSession
  readonly turns: string[] = []
  constructor(id: string, private readonly onTurn: (turn: number, session: FakeSession) => void) {
    this.id = SessionId(id)
    this.session = new FakeSession(this.id)
  }
  async whenIdle(): Promise<void> {}
  followup(message: UserMessage): void {
    this.turns.push(message.content.map(block => (block.type === 'text' ? block.text : '')).join(''))
    this.onTurn(this.turns.length, this.session)
  }
}
const asAgent = (fake: FakeAgent): Agent => fake as unknown as Agent

/** Two assistant messages worth of usage, the first with a cache read, the second with reasoning tokens. */
function assistantTurns(turn: number, session: FakeSession): void {
  const usage = turn === 1
    ? { inputTokens: 11, outputTokens: 3, cacheReadTokens: 2 }
    : { inputTokens: 7, outputTokens: 5, reasoningTokens: 1 }
  session.append('assistant/message', { turn, step: 1, usage, message: { content: [] } })
  session.append('assistant/message', { turn, step: 2, message: { content: [] } })
}

class StubEnvironments extends Service {
  static current: StubEnvironments
  readonly definitions = new Map<string, EnvironmentDefinition>()
  constructor(ctx: Context) {
    super(ctx, 'environments')
    StubEnvironments.current = this
  }
  get(id: string): EnvironmentDefinition | undefined {
    return this.definitions.get(id)
  }
}

class StubDefaultModel extends Service {
  constructor(ctx: Context) {
    super(ctx, 'agentDefaultModel')
  }
  currentSelection() {
    return { provider: 'mock', model: 'mock-default' }
  }
}

class StubAgents extends Service {
  static current: StubAgents
  readonly created: CreateAgentOptions[] = []
  disposed = 0
  agent = new FakeAgent('unused', () => {})
  constructor(ctx: Context) {
    super(ctx, 'agents')
    StubAgents.current = this
  }
  async create(options: CreateAgentOptions) {
    this.created.push(options)
    await options.setup?.(this.ctx)
    return { agent: asAgent(this.agent), dispose: async () => { this.disposed += 1 } }
  }
}

class StubGoals extends Service {
  static current: StubGoals
  readonly created: CreateGoalRequest[] = []
  readonly completed: GoalRef[] = []
  disarmed = 0
  goal: GoalView | undefined
  readMode: 'same' | 'other' | 'none' = 'same'
  constructor(ctx: Context) {
    super(ctx, 'goals')
    StubGoals.current = this
  }
  create(_agent: Agent, request: CreateGoalRequest): GoalView {
    this.created.push(request)
    this.goal = {
      id: GoalId('goal-1'),
      revision: 1,
      objective: request.objective,
      phase: 'active',
      maxGoalRounds: request.maxGoalRounds ?? 256,
      roundsStarted: 0,
      createdAt: 1,
      updatedAt: 1,
      activation: 'armed',
    }
    return this.goal
  }
  disarm(): GoalView | undefined {
    this.disarmed += 1
    return this.goal
  }
  get(): GoalView | undefined {
    if (this.readMode === 'none' || this.goal === undefined) return undefined
    return this.readMode === 'other' ? { ...this.goal, id: GoalId('goal-2') } : this.goal
  }
  complete(_agent: Agent, ref: GoalRef): GoalView {
    this.completed.push(ref)
    return { ...(this.goal as GoalView), phase: 'complete', revision: ref.revision + 1 }
  }
}

class StubStandards extends Service {
  static current: StubStandards
  readonly runs: {
    ref: StandardRef
    isolation: CertificateIsolation
    results: readonly CheckResult[]
    evidence: RunEvidence
  }[] = []
  readonly directives: DirectiveRequest[] = []
  view: StandardView | undefined
  readMode: 'same' | 'otherGoal' | 'none' = 'same'
  constructor(ctx: Context) {
    super(ctx, 'completionStandards')
    StubStandards.current = this
  }
  author(_agent: Agent, request: AuthorStandardRequest): StandardView {
    this.view = {
      id: StandardId('standard-1'),
      revision: 1,
      goalId: request.goalId,
      checks: [...request.checks],
      relaxed: [],
      createdAt: 1,
      updatedAt: 1,
      directivesIssued: 0,
      runsRecorded: 0,
    }
    return this.view
  }
  get(): StandardView | undefined {
    if (this.readMode === 'none' || this.view === undefined) return undefined
    return this.readMode === 'otherGoal' ? { ...this.view, goalId: GoalId('goal-9') } : this.view
  }
  recordRun(
    _agent: Agent,
    ref: StandardRef,
    isolation: CertificateIsolation,
    results: readonly CheckResult[],
    evidence: RunEvidence,
  ): RunOutcome {
    this.runs.push({ ref, isolation, results, evidence })
    const failures = results.filter(result => result.status === 'fail')
    if (failures.length > 0) return { certified: false, failures }
    return {
      certified: true,
      certificate: { standard: ref, goalId: (this.view as StandardView).goalId, isolation, results: [...results], recordedAt: 5 },
    }
  }
  issueDirective(_agent: Agent, _ref: StandardRef, request: DirectiveRequest): void {
    this.directives.push(request)
  }
}

type ShellResultInput = Partial<Omit<ShellRunResult, 'stdout' | 'stderr'>> & { stdout?: string; stderr?: string }

function shellResult(partial: ShellResultInput = {}): ShellRunResult {
  const { stdout = '', stderr = '', ...rest } = partial
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: 1000,
    ...rest,
    stdout: { text: stdout, truncated: false },
    stderr: { text: stderr, truncated: false },
  }
}

class StubShell extends Service {
  static current: StubShell
  readonly requests: ShellExecRequest[] = []
  readonly scripted = new Map<string, ShellRunResult[]>()
  constructor(ctx: Context) {
    super(ctx, 'shell')
    StubShell.current = this
  }
  script(command: string, ...results: ShellRunResult[]): void {
    this.scripted.set(command, results)
  }
  resolve(request: ShellExecRequest): ShellExecSpec {
    this.requests.push(request)
    return { command: request.command, workdir: request.workdir ?? '/unset', timeoutMs: request.timeoutMs ?? 30_000, stdoutMaxBytes: 4096, sandboxPolicy: undefined }
  }
  async run(spec: ShellExecSpec): Promise<ShellRunResult> {
    const queue = this.scripted.get(spec.command)
    const next = queue?.shift()
    if (next === undefined) throw new Error(`no scripted result for ${spec.command}`)
    return next
  }
}

class StubSessions extends Service {
  static current: StubSessions
  flushed = 0
  constructor(ctx: Context) {
    super(ctx, 'sessions')
    StubSessions.current = this
  }
  async flush(): Promise<void> {
    this.flushed += 1
  }
}

const MARKER = 'test -f MARKER'

function environment(rest: Partial<EnvironmentDefinition> = {}): EnvironmentDefinition {
  return {
    id: EnvironmentId('smoke:marker'),
    kind: 'smoke',
    name: 'marker',
    description: 'the workspace ends up holding MARKER',
    task: { prompt: 'Create a file named MARKER in the workspace.' },
    checks: [{ id: CheckId('marker'), outcome: 'MARKER exists', run: MARKER }],
    heldOut: false,
    owner: '@deepseek-ai/dsh-environment-runner-tests',
    provenance: 'curated',
    detail: {},
    ...rest,
  }
}

interface Scenario {
  config?: Partial<Config>
  definition?: EnvironmentDefinition
  onTurn?: (turn: number, session: FakeSession) => void
}

interface Harness {
  ctx: Context
  workspace: string
  run: (extra?: object) => Promise<EnvironmentRunReport>
}

async function harness(scenario: Scenario = {}): Promise<Harness> {
  const ctx = new Context()
  for (const stub of [StubEnvironments, StubDefaultModel, StubAgents, StubGoals, StubStandards, StubShell, StubSessions]) {
    await ctx.plugin(stub)
  }
  await ctx.plugin(EnvironmentRunner, { isolation: 'process', ...scenario.config })
  const definition = scenario.definition ?? environment()
  StubEnvironments.current.definitions.set(definition.id, definition)
  StubAgents.current.agent = new FakeAgent('environment-test', scenario.onTurn ?? assistantTurns)
  const workspace = await mkdtemp(join(tmpdir(), 'environment-runner-'))
  const run = (extra: object = {}) => ctx.environmentRuns.run({ environment: definition.id, workspace, ...extra })
  return { ctx, workspace, run }
}

describe('EnvironmentRunner', () => {
  it('stamps the session, authors the standard, validates once, completes the goal, and reports', async () => {
    const { workspace, run } = await harness()
    StubShell.current.script(MARKER, shellResult({ stdout: 'present\n' }))
    const report = await run()

    expect(report.certified).toBe(true)
    expect(report.attempts).toEqual([{
      attempt: 1,
      results: [{ checkId: 'marker', status: 'pass', evidence: 'exit 0\nstdout: present' }],
      treeHash: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown as string,
    }])
    expect(report.certificate).toMatchObject({ isolation: 'process', goalId: 'goal-1', standard: { id: 'standard-1', revision: 1 } })
    expect(report.usage).toEqual({ inputTokens: 11, outputTokens: 3, cacheReadTokens: 2 })
    expect(report.sessionId).toBe('environment-test')

    const stamp = report.stamp
    expect(stamp).toMatchObject<Partial<EnvironmentRunStamp>>({
      kind: 'environment/run', version: 1, environmentId: EnvironmentId('smoke:marker'), environmentKind: 'smoke', heldOut: false,
      repetition: 0, model: { provider: 'mock', model: 'mock-default' }, isolation: 'process',
    })
    expect(stamp).not.toHaveProperty('fixtureSha256')
    expect(stamp).not.toHaveProperty('group')
    const agent = StubAgents.current.agent
    expect(agent.session.events[0]).toMatchObject({ type: 'environment/run', data: stamp })
    expect(agent.turns).toEqual(['Create a file named MARKER in the workspace.'])

    expect(StubAgents.current.created[0]).toMatchObject({ meta: { cwd: workspace }, agentOptions: { provider: 'mock', model: 'mock-default' } })
    expect(StubAgents.current.created[0]?.sessionId).toMatch(/^environment-/)
    expect(StubAgents.current.created[0]).not.toHaveProperty('signal')
    expect(StubAgents.current.disposed).toBe(1)
    expect(StubGoals.current.created).toEqual([{ objective: 'Create a file named MARKER in the workspace.' }])
    expect(StubGoals.current.disarmed).toBe(1)
    expect(StubGoals.current.completed).toEqual([{ id: 'goal-1', revision: 1 }])
    expect(StubStandards.current.view?.checks).toEqual([{ id: 'marker', outcome: 'MARKER exists', run: MARKER }])
    expect(StubStandards.current.runs).toHaveLength(1)
    expect(StubStandards.current.runs[0]?.evidence)
      .toEqual({ executor: 'runner', treeHash: report.attempts[0]?.treeHash })
    expect(StubStandards.current.directives).toEqual([])
    expect(StubShell.current.requests).toEqual([{ command: MARKER, workdir: workspace, timeoutMs: undefined, signal: undefined }])
    expect(StubSessions.current.flushed).toBe(1)
  })

  it('issues a directive, sends the validation follow-up as a user turn, and certifies on the second attempt', async () => {
    const { run } = await harness({ config: { maxAttempts: 2 } })
    StubShell.current.script(MARKER, shellResult({ exitCode: 1, stderr: 'no MARKER\n' }), shellResult())
    const report = await run({ repetition: 2, group: 'batch-7' })

    expect(report.certified).toBe(true)
    expect(report.attempts.map(attempt => attempt.results[0]?.status)).toEqual(['fail', 'pass'])
    expect(report.stamp).toMatchObject({ repetition: 2, group: 'batch-7' })
    expect(report.usage).toEqual({ inputTokens: 18, outputTokens: 8, cacheReadTokens: 2, reasoningTokens: 1 })
    expect(StubStandards.current.directives).toEqual([{ rootCause: "1 of the standard's checks failed", detail: '1. exit 1\nstderr: no MARKER' }])
    expect(StubAgents.current.agent.turns[1]).toBe(
      "<validation_failed>\n1 of the standard's checks failed\n1. exit 1\nstderr: no MARKER\nContinue working on the task; the validator runs again when you stop.\n</validation_failed>",
    )
    expect(StubGoals.current.completed).toHaveLength(1)
  })

  it('reports an uncertified run after the attempt budget with one directive per attempt', async () => {
    const { run } = await harness({ config: { maxAttempts: 2 } })
    StubShell.current.script(MARKER, shellResult({ exitCode: 2 }), shellResult({ exitCode: 2 }))
    const report = await run()
    expect(report.certified).toBe(false)
    expect(report).not.toHaveProperty('certificate')
    expect(report.attempts).toHaveLength(2)
    expect(StubStandards.current.directives).toHaveLength(2)
    expect(StubGoals.current.completed).toEqual([])
    expect(StubSessions.current.flushed).toBe(1)
    expect(StubAgents.current.disposed).toBe(1)
  })

  it('names timeouts, aborts, and signals in the evidence and bounds every string', async () => {
    const checks = [
      { id: CheckId('slow'), outcome: 'finishes', run: 'sleep 9' },
      { id: CheckId('killed'), outcome: 'survives', run: 'run-killed' },
      { id: CheckId('vanished'), outcome: 'exits', run: 'run-vanished' },
      { id: CheckId('cancelled'), outcome: 'runs', run: 'run-cancelled' },
      { id: CheckId('chatty'), outcome: 'quiet', run: 'run-chatty' },
    ]
    const { run } = await harness({
      config: { evidenceMaxChars: 60, checkTimeoutMs: 250, maxGoalRounds: 3 },
      definition: environment({ checks }),
    })
    const shell = StubShell.current
    shell.script('sleep 9', shellResult({ exitCode: null, signal: 'SIGKILL', timedOut: true, timeoutMs: 250 }))
    shell.script('run-killed', shellResult({ exitCode: null, signal: 'SIGTERM' }))
    shell.script('run-vanished', shellResult({ exitCode: null }))
    shell.script('run-cancelled', shellResult({ exitCode: 130, aborted: true, stdout: 'partial' }))
    shell.script('run-chatty', shellResult({ stdout: 'x'.repeat(100), stderr: 'y'.repeat(100) }))
    const controller = new AbortController()
    const report = await run({ signal: controller.signal })

    const evidence = report.attempts[0]?.results.map(result => result.evidence) ?? []
    expect(evidence[0]).toBe('terminated by SIGKILL after the 250ms timeout')
    expect(evidence[1]).toBe('terminated by SIGTERM')
    expect(evidence[2]).toBe('terminated by an unknown signal')
    expect(evidence[3]).toBe('exit 130 after the run was aborted\nstdout: partial')
    expect(evidence[4]).toHaveLength(60)
    expect(evidence[4]?.startsWith('exit 0\n…')).toBe(true)
    expect(evidence[4]?.endsWith('y'.repeat(52))).toBe(true)
    expect(report.attempts[0]?.results.map(result => result.status)).toEqual(['fail', 'fail', 'fail', 'fail', 'pass'])
    expect(StubStandards.current.directives[0]?.detail).toHaveLength(60)
    expect(StubStandards.current.directives[0]?.detail.startsWith('1. terminated by SIGKILL')).toBe(true)
    expect(StubShell.current.requests[0]).toMatchObject({ timeoutMs: 250, signal: controller.signal })
    expect(StubAgents.current.created[0]?.signal).toBe(controller.signal)
    expect(StubGoals.current.created[0]).toEqual({ objective: 'Create a file named MARKER in the workspace.', maxGoalRounds: 3 })
  })

  it('keeps a bound shorter than the first line as a plain prefix', async () => {
    const { run } = await harness({ config: { evidenceMaxChars: 4 } })
    StubShell.current.script(MARKER, shellResult({ exitCode: 1, stderr: 'boom' }))
    const report = await run()
    expect(report.attempts[0]?.results[0]?.evidence).toBe('exit')
  })

  it('uses the requested model route and omits usage when the model produced no message', async () => {
    const { run } = await harness({ onTurn: () => {} })
    StubShell.current.script(MARKER, shellResult())
    const report = await run({ model: { provider: 'other', model: 'candidate-7' } })
    expect(report).not.toHaveProperty('usage')
    expect(report.stamp.model).toEqual({ provider: 'other', model: 'candidate-7' })
    expect(StubAgents.current.created[0]?.agentOptions).toEqual({ provider: 'other', model: 'candidate-7' })
  })

  it('overlays and hashes the fixture before the run', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'environment-fixture-'))
    await mkdir(join(fixture, 'sub'))
    await writeFile(join(fixture, 'seed.txt'), 'seed')
    await writeFile(join(fixture, 'sub', 'deep.txt'), 'deep')
    const { workspace, run } = await harness({ definition: environment({ task: { prompt: 'Extend the seed.', fixture } }) })
    StubShell.current.script(MARKER, shellResult())
    const report = await run()
    expect(await readFile(join(workspace, 'seed.txt'), 'utf8')).toBe('seed')
    expect(await readFile(join(workspace, 'sub', 'deep.txt'), 'utf8')).toBe('deep')
    expect(report.stamp.fixtureSha256).toMatch(/^[0-9a-f]{64}$/)
    const bare = (await harness()).run
    StubShell.current.script(MARKER, shellResult())
    expect((await bare()).stamp.contentSha256).not.toBe(report.stamp.contentSha256)
  })

  it('restores the fixture over the implementer edits before each validation', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'environment-fixture-'))
    await writeFile(join(fixture, 'seed.txt'), 'seed')
    let workspace = ''
    const built = await harness({
      config: { maxAttempts: 2 },
      definition: environment({ task: { prompt: 'Extend the seed.', fixture } }),
      onTurn: (turn, session) => {
        assistantTurns(turn, session)
        writeFileSync(join(workspace, 'seed.txt'), `tampered on turn ${turn}`)
      },
    })
    workspace = built.workspace
    StubShell.current.script(MARKER, shellResult({ exitCode: 1 }), shellResult())
    const report = await built.run()

    expect(await readFile(join(workspace, 'seed.txt'), 'utf8')).toBe('seed')
    expect(report.attempts.map(attempt => attempt.treeHash))
      .toEqual([report.attempts[0]?.treeHash, report.attempts[0]?.treeHash])
    expect(StubStandards.current.runs.map(run => run.evidence.treeHash))
      .toEqual([report.attempts[0]?.treeHash, report.attempts[0]?.treeHash])
  })

  it('rejects an unknown environment and an unusable workspace or fixture before any agent exists', async () => {
    const { workspace, ctx } = await harness()
    const reject = async (request: object, code: string) => {
      await expect(ctx.environmentRuns.run({ environment: EnvironmentId('smoke:marker'), workspace, ...request }))
        .rejects.toMatchObject({ code })
    }
    await expect(ctx.environmentRuns.run({ environment: EnvironmentId('smoke:missing'), workspace }))
      .rejects.toBeInstanceOf(EnvironmentRunError)
    await reject({ environment: EnvironmentId('smoke:missing') }, 'ENVIRONMENT_RUN_UNKNOWN_ENVIRONMENT')
    await reject({ workspace: 'relative/dir' }, 'ENVIRONMENT_RUN_INVALID_WORKSPACE')
    await reject({ workspace: join(workspace, 'absent') }, 'ENVIRONMENT_RUN_INVALID_WORKSPACE')
    StubEnvironments.current.definitions.set('smoke:marker', environment({ task: { prompt: 'p', fixture: 'fixtures/relative' } }))
    await reject({}, 'ENVIRONMENT_RUN_INVALID_FIXTURE')
    StubEnvironments.current.definitions.set('smoke:marker', environment({ task: { prompt: 'p', fixture: join(workspace, 'no-fixture') } }))
    await reject({}, 'ENVIRONMENT_RUN_INVALID_FIXTURE')
    expect(StubAgents.current.created).toEqual([])
  })

  it('fails loudly, flushes, and disposes when the implementer replaced the goal or the standard is gone', async () => {
    for (const [goals, standards, code] of [
      ['other', 'same', 'ENVIRONMENT_RUN_GOAL_REPLACED'],
      ['none', 'same', 'ENVIRONMENT_RUN_GOAL_REPLACED'],
      ['same', 'otherGoal', 'ENVIRONMENT_RUN_STANDARD_LOST'],
      ['same', 'none', 'ENVIRONMENT_RUN_STANDARD_LOST'],
    ] as const) {
      const { run } = await harness()
      StubGoals.current.readMode = goals
      StubStandards.current.readMode = standards
      StubShell.current.script(MARKER, shellResult())
      await expect(run()).rejects.toMatchObject({ code })
      expect(StubSessions.current.flushed).toBe(1)
      expect(StubAgents.current.disposed).toBe(1)
    }
  })

  it('resolves defaults once, at the boundary', () => {
    expect(resolveConfig({ isolation: 'host' })).toEqual({
      isolation: 'host', maxAttempts: 1, maxGoalRounds: undefined, checkTimeoutMs: undefined, evidenceMaxChars: 2000,
    })
    expect(resolveConfig({ isolation: 'none', maxAttempts: 3, maxGoalRounds: 5, checkTimeoutMs: 10, evidenceMaxChars: 50 })).toEqual({
      isolation: 'none', maxAttempts: 3, maxGoalRounds: 5, checkTimeoutMs: 10, evidenceMaxChars: 50,
    })
  })

  it('registers its empty invariant companion', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(invariantCompanion)).resolves.toBeDefined()
  })
})
