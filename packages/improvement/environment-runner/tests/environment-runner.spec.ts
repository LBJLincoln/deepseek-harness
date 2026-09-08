import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
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
import * as budgetPolicy from '@deepseek-ai/dsh-budget-policy'
import { NO_START_CAPABILITIES } from '@deepseek-ai/dsh-subagent'
import type { SubagentProvider, SubagentResult, SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { caseChannelDigest, CheckCaseId, checkCasesRef, CheckId, hashWorkspaceTree, StandardId } from '@deepseek-ai/dsh-verification'
import type {
  AuthoredCheck,
  AuthorStandardRequest,
  CertificateIsolation,
  CheckCase,
  CheckCaseNormalizer,
  CheckResult,
  DirectiveRequest,
  RunEvidence,
  RunOutcome,
  StandardRef,
  StandardView,
} from '@deepseek-ai/dsh-verification'
import EnvironmentRunner, {
  caseExpectation,
  EnvironmentRunError,
  implementerName,
  implementerTranscript,
  resolveConfig,
  resolveImplementer,
  resolveLadder,
} from '@deepseek-ai/dsh-environment-runner'
import type { Config, EnvironmentRunImplementer, EnvironmentRunReport } from '@deepseek-ai/dsh-environment-runner'
import * as invariantCompanion from '@deepseek-ai/dsh-environment-runner/invariant'

declare module '@deepseek-ai/dsh-environments/types' {
  interface EnvironmentKindMap {
    smoke: Record<string, never>
  }
}

/**
 * The live-agent surface the runner drives, with a log that records what the
 * runner appends. Event times are wall-clock, like the real store's, so the
 * budget policy's wall measurement means the same thing here.
 */
class FakeSession {
  readonly events: SessionEvent[] = []
  seq = 0
  constructor(readonly id: SessionId) {}
  append(type: string, data: unknown): SessionEvent {
    const event = { type, seq: this.seq, time: Date.now(), data } as unknown as SessionEvent
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
  readonly blocked: { ref: GoalRef; reason: { code: string; message: string } }[] = []
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
  block(_agent: Agent, ref: GoalRef, reason: { code: string; message: string }): GoalView {
    this.blocked.push({ ref, reason })
    this.goal = { ...(this.goal as GoalView), phase: 'blocked', revision: ref.revision + 1 }
    return this.goal
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
      certificate: {
        standard: ref,
        goalId: (this.view as StandardView).goalId,
        isolation,
        executor: evidence.executor,
        results: [...results],
        recordedAt: 5,
      },
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

class StubReadBarrier extends Service {
  static current: StubReadBarrier
  root = ''
  readonly reserved: string[] = []
  /** One entry per session-scoped denial the runner registered, in registration order. */
  readonly denied: { readonly session: string; readonly path: string; disposed: boolean }[] = []
  constructor(ctx: Context) {
    super(ctx, 'readBarrier')
    StubReadBarrier.current = this
  }
  reserve(agent: Agent): string {
    this.reserved.push(agent.id)
    const directory = join(this.root, 'runs', agent.id)
    mkdirSync(directory, { recursive: true })
    return directory
  }
  denyFor(session: FakeSession, path: string): () => void {
    const entry = { session: session.id as string, path, disposed: false }
    this.denied.push(entry)
    return () => { entry.disposed = true }
  }
}

/** A provider advertising every start-time capability, which is what an in-process driver does. */
const IN_PROCESS_CAPABILITIES: SubagentProvider['capabilities'] = {
  outputSchema: true,
  depthLimit: true,
  toolFilter: true,
  persona: true,
  harnessTools: false,
  model: true,
}

/** An out-of-process product provider: it enforces no start feature here, but its product takes a model. */
const PRODUCT_CAPABILITIES: SubagentProvider['capabilities'] = { ...NO_START_CAPABILITIES, model: true }

/** What one scripted child run resolves with and leaves behind. */
interface ScriptedChild {
  readonly result?: SubagentResult
  /** Assistant usage of an in-process child's own session; absent publishes a remote run. */
  readonly childUsage?: { inputTokens: number; outputTokens: number }
  /** What the child did to the workspace before it settled. */
  readonly work?: (workspace: string) => void
  /** Settle only once the start signal aborts, as a provider whose child runs until cancelled does. */
  readonly untilAborted?: true
  /** Reject the start once the signal aborts, as a provider refusing to start an already-cancelled run does. */
  readonly failsToStart?: true
}

/** A promise that settles when `signal` aborts, or at once when it already has. */
function whenAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => { resolve() }, { once: true })
  })
}

/** The subagent seam as the runner reads it: a provider registry and one published run per start. */
class StubSubagents extends Service {
  static current: StubSubagents
  readonly providers = new Map<string, SubagentProvider>()
  readonly started: { name: string; request: SubagentStartRequest }[] = []
  disposed = 0
  workspace = ''
  /** One entry per start, in start order; a start past the end settles as a bare completion. */
  children: ScriptedChild[] = []
  constructor(ctx: Context) {
    super(ctx, 'subagents')
    StubSubagents.current = this
  }

  register(name: string, capabilities: SubagentProvider['capabilities']): void {
    this.providers.set(name, { name, capabilities, inheritsParentContext: false, start: () => Promise.reject(new Error('unused')) })
  }

  getProvider(name: string): SubagentProvider | undefined {
    return this.providers.get(name)
  }

  async start(name: string, request: SubagentStartRequest): Promise<SubagentRun> {
    this.started.push({ name, request })
    const scripted = this.children[this.started.length - 1] ?? {}
    if (scripted.failsToStart === true) {
      await whenAborted(request.signal)
      throw new Error('stub-subagents: the run was cancelled before startup')
    }
    scripted.work?.(this.workspace)
    const child = new FakeAgent(`child-${this.started.length}`, () => {})
    if (scripted.childUsage !== undefined) {
      child.session.append('assistant/message', { turn: 1, step: 1, usage: scripted.childUsage, message: { content: [] } })
    }
    const settled: SubagentResult = scripted.result ?? { output: [], stopReason: 'completed' }
    return {
      id: SessionId(`child-${this.started.length}`),
      localAgent: scripted.childUsage === undefined ? undefined : asAgent(child),
      result: scripted.untilAborted === true
        ? whenAborted(request.signal).then(() => settled)
        : Promise.resolve(settled),
      dispose: async () => { this.disposed += 1 },
    }
  }
}

/**
 * The route one more step of the cell agent would take. The installed selection
 * names the model it will assemble under in the prompt variables, so driving
 * that one waterfall states the rung the ladder left the agent on.
 */
async function applied(ctx: Context): Promise<Record<string, string | undefined>> {
  const assembly = { sections: [], contexts: [], tools: [], variables: {} }
  const assembled = await ctx.waterfall('system-prompt/assemble', assembly, {}, () => Promise.resolve(assembly))
  return assembled.variables
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
  /** Mount the read barrier so the run reserves a directory; its prefix names the barrier root. */
  barrierPrefix?: string
  /** Mount the subagent seam and register these providers under their names. */
  providers?: Readonly<Record<string, SubagentProvider['capabilities']>>
  /** Caps the composed budget policy enforces; omitted composes it uncapped. */
  budget?: budgetPolicy.Config
  /** Compose no budget policy at all, which is what an unbounded delegated run needs. */
  unbudgeted?: true
}

interface Harness {
  ctx: Context
  workspace: string
  barrierRoot: string | undefined
  run: (extra?: object) => Promise<EnvironmentRunReport>
}

async function harness(scenario: Scenario = {}): Promise<Harness> {
  const ctx = new Context()
  for (const stub of [StubEnvironments, StubDefaultModel, StubAgents, StubGoals, StubStandards, StubShell, StubSessions]) {
    await ctx.plugin(stub)
  }
  let barrierRoot: string | undefined
  if (scenario.barrierPrefix !== undefined) {
    await ctx.plugin(StubReadBarrier)
    barrierRoot = await mkdtemp(join(tmpdir(), scenario.barrierPrefix))
    StubReadBarrier.current.root = barrierRoot
  }
  if (scenario.providers !== undefined) {
    await ctx.plugin(StubSubagents)
    for (const [name, capabilities] of Object.entries(scenario.providers)) StubSubagents.current.register(name, capabilities)
  }
  // Village rule: a composition running unattended cells carries a session
  // budget, and a delegated run is refused without one.
  if (scenario.unbudgeted !== true) await ctx.plugin(budgetPolicy, scenario.budget ?? {})
  await ctx.plugin(EnvironmentRunner, { isolation: 'process', ...scenario.config })
  const definition = scenario.definition ?? environment()
  StubEnvironments.current.definitions.set(definition.id, definition)
  StubAgents.current.agent = new FakeAgent('environment-test', scenario.onTurn ?? assistantTurns)
  const workspace = await mkdtemp(join(tmpdir(), 'environment-runner-'))
  if (scenario.providers !== undefined) StubSubagents.current.workspace = workspace
  const run = (extra: object = {}) => ctx.environmentRuns.run({ environment: definition.id, workspace, ...extra })
  return { ctx, workspace, barrierRoot, run }
}

describe('EnvironmentRunner', () => {
  it('stamps the session, authors the standard, validates once, completes the goal, and reports', async () => {
    const { workspace, run } = await harness()
    StubShell.current.script(MARKER, shellResult({ stdout: 'present\n' }))
    const report = await run()

    expect(report.certified).toBe(true)
    expect(report.attempts).toEqual([{
      attempt: 1,
      model: { provider: 'mock', model: 'mock-default' },
      transcript: 'kept',
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
    expect(stamp).not.toHaveProperty('district')
    expect(stamp).not.toHaveProperty('policyVersion')
    expect(stamp).not.toHaveProperty('seed')
    expect(stamp).not.toHaveProperty('ladder')
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

  it('reserves the run, writes the standard and one script per check, and runs the script', async () => {
    const { run, barrierRoot, workspace } = await harness({ barrierPrefix: 'environment-runner-barrier-' })
    const reservation = join(barrierRoot ?? '', 'runs', 'environment-test')
    const script = join(reservation, 'checks', 'marker', 'run')
    StubShell.current.script(`. ${script}`, shellResult({ stdout: 'present\n' }))
    const report = await run()

    expect(report.certified).toBe(true)
    expect(StubReadBarrier.current.reserved).toEqual(['environment-test'])
    expect(await readFile(script, 'utf8')).toBe(`${MARKER}\n`)
    expect(JSON.parse(await readFile(join(reservation, 'standard.json'), 'utf8')))
      .toMatchObject({ id: 'standard-1', revision: 1, checks: [{ id: 'marker', run: MARKER }] })
    // The command line names the script, never the instruction it carries.
    expect(StubShell.current.requests).toEqual([{ command: `. ${script}`, workdir: workspace, timeoutMs: undefined, signal: undefined }])
  })

  it('denies the cell everything above its workspace for the length of the run, and counts what it refused', async () => {
    const { run, workspace, barrierRoot } = await harness({
      barrierPrefix: 'environment-runner-seal-',
      onTurn: (_turn, session) => {
        session.append('read-barrier/denied', { version: 1, role: 'implementer', capability: 'shell', displayPath: '../plan.json', root: '/barrier' })
        session.append('read-barrier/denied', { version: 1, role: 'implementer', capability: 'fs', displayPath: '../cell-b/src.js', root: '/barrier' })
      },
    })
    StubShell.current.script(`. ${join(barrierRoot ?? '', 'runs', 'environment-test', 'checks', 'marker', 'run')}`, shellResult({ stdout: 'present\n' }))
    const report = await run()

    expect(StubReadBarrier.current.denied).toEqual([
      { session: 'environment-test', path: dirname(workspace), disposed: true },
    ])
    expect(report.escapesDenied).toBe(2)
  })

  it('registers no denial without a composed barrier and reports no refused read', async () => {
    const { ctx, run } = await harness()
    StubShell.current.script(MARKER, shellResult({ stdout: 'present\n' }))
    const report = await run()
    expect(ctx.get('readBarrier')).toBeUndefined()
    expect(report.escapesDenied).toBe(0)
  })

  it('copies a held-out environment fixture into the reservation', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'environment-runner-heldout-'))
    await writeFile(join(fixture, 'expected.txt'), 'reference\n')
    const { run, barrierRoot } = await harness({
      barrierPrefix: 'environment-runner-heldout-barrier-',
      definition: environment({ heldOut: true, task: { prompt: 'Create a file named MARKER in the workspace.', fixture } }),
    })
    const script = join(barrierRoot ?? '', 'runs', 'environment-test', 'checks', 'marker', 'run')
    StubShell.current.script(`. ${script}`, shellResult())
    await run()
    expect(await readFile(join(barrierRoot ?? '', 'runs', 'environment-test', 'fixture', 'expected.txt'), 'utf8')).toBe('reference\n')
  })

  it('stages the reference beneath the reservation and keeps it out of every workspace overlay', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'environment-runner-reference-'))
    await mkdir(join(fixture, 'reference'), { recursive: true })
    await writeFile(join(fixture, 'reference', 'run'), 'printf reference\n')
    await writeFile(join(fixture, 'README.txt'), 'the task\n')
    const { run, barrierRoot, workspace } = await harness({
      barrierPrefix: 'environment-runner-reference-barrier-',
      definition: environment({
        task: { prompt: 'Create a file named MARKER in the workspace.', fixture, reference: 'reference' },
      }),
    })
    const reservation = join(barrierRoot ?? '', 'runs', 'environment-test')
    const script = join(reservation, 'checks', 'marker', 'run')
    StubShell.current.script(`. ${script}`, shellResult())
    const report = await run()

    expect(await readFile(join(reservation, 'reference', 'run'), 'utf8')).toBe('printf reference\n')
    // The rest of the fixture reaches the workspace; the reference never does,
    // on the first overlay or on the one before each validation.
    expect(await readFile(join(workspace, 'README.txt'), 'utf8')).toBe('the task\n')
    await expect(stat(join(workspace, 'reference'))).rejects.toThrow()
    // The fixture digest still covers the reference tree it was hashed from.
    expect(report.stamp.fixtureSha256).toBe(await hashWorkspaceTree(fixture))
  })

  it('stages one agent\'s reference on request, and refuses what it cannot stage', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'environment-runner-stage-'))
    await mkdir(join(fixture, 'reference'), { recursive: true })
    await writeFile(join(fixture, 'reference', 'run'), 'printf reference\n')
    const referencing = environment({
      id: EnvironmentId('smoke:referencing'),
      task: { prompt: 'Create a file named MARKER in the workspace.', fixture, reference: 'reference' },
    })
    const { ctx, barrierRoot } = await harness({ barrierPrefix: 'environment-runner-stage-barrier-' })
    StubEnvironments.current.definitions.set(referencing.id, referencing)
    const agent = asAgent(new FakeAgent('validator-test', () => {}))
    const reservation = await ctx.environmentRuns.stageReference(agent, referencing.id)

    expect(reservation).toBe(join(barrierRoot ?? '', 'runs', 'validator-test'))
    expect(await readFile(join(reservation, 'reference', 'run'), 'utf8')).toBe('printf reference\n')

    await expect(ctx.environmentRuns.stageReference(agent, EnvironmentId('smoke:absent')))
      .rejects.toThrow(new EnvironmentRunError('environment "smoke:absent" is not registered', 'ENVIRONMENT_RUN_UNKNOWN_ENVIRONMENT'))
    await expect(ctx.environmentRuns.stageReference(agent, EnvironmentId('smoke:marker')))
      .rejects.toThrow(new EnvironmentRunError('environment "smoke:marker" declares no task reference to stage', 'ENVIRONMENT_RUN_NO_REFERENCE'))
  })

  it('refuses to stage a reference without a composed barrier to reserve from', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'environment-runner-unreserved-'))
    await mkdir(join(fixture, 'reference'), { recursive: true })
    const referencing = environment({
      id: EnvironmentId('smoke:referencing'),
      task: { prompt: 'Create a file named MARKER in the workspace.', fixture, reference: 'reference' },
    })
    const { ctx } = await harness()
    StubEnvironments.current.definitions.set(referencing.id, referencing)
    const agent = asAgent(new FakeAgent('validator-test', () => {}))

    await expect(ctx.environmentRuns.stageReference(agent, referencing.id))
      .rejects.toThrow(new EnvironmentRunError('staging a reference requires a composed read barrier to reserve from', 'ENVIRONMENT_RUN_NO_RESERVATION'))
  })

  it('refuses a check id that cannot name a reserved script file', async () => {
    const { run } = await harness({
      barrierPrefix: 'environment-runner-badid-',
      definition: environment({ checks: [{ id: CheckId('../escape'), outcome: 'escapes', run: MARKER }] }),
    })
    await expect(run()).rejects.toThrow(new EnvironmentRunError('check "../escape" cannot name a reserved script file', 'ENVIRONMENT_RUN_UNSAFE_CHECK_SCRIPT'))
  })

  it('refuses a reservation whose path the check command line cannot carry unquoted', async () => {
    const { run, barrierRoot } = await harness({ barrierPrefix: 'environment runner spaced ' })
    const script = join(barrierRoot ?? '', 'runs', 'environment-test', 'checks', 'marker', 'run')
    await expect(run()).rejects.toThrow(new EnvironmentRunError(`reserved check script "${script}" contains characters the check command line cannot carry unquoted`, 'ENVIRONMENT_RUN_UNSAFE_CHECK_SCRIPT'))
  })

  it('issues a directive, sends the validation follow-up as a user turn, and certifies on the second attempt', async () => {
    const { run } = await harness({ config: { maxAttempts: 2 } })
    StubShell.current.script(MARKER, shellResult({ exitCode: 1, stderr: 'no MARKER\n' }), shellResult())
    const report = await run({ repetition: 2, group: 'batch-7', district: 'workshop' })

    expect(report.certified).toBe(true)
    expect(report.attempts.map(attempt => attempt.results[0]?.status)).toEqual(['fail', 'pass'])
    expect(report.stamp).toMatchObject({ repetition: 2, group: 'batch-7', district: 'workshop' })
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

  it('runs each attempt on its rung, states it per attempt, and stamps the ladder', async () => {
    const small = { provider: 'mock', model: 'small' }
    const large = { provider: 'mock', model: 'large' }
    const { ctx, run } = await harness({ config: { maxAttempts: 1 } })
    StubShell.current.script(MARKER, shellResult({ exitCode: 1 }), shellResult({ exitCode: 1 }), shellResult())
    // Three rungs override a composition that allows one attempt.
    const report = await run({ model: small, ladder: [{}, { model: large }, { model: large }] })

    expect(report.certified).toBe(true)
    expect(report.attempts.map(attempt => attempt.model)).toEqual([small, large, large])
    expect(report.attempts.map(attempt => attempt.transcript)).toEqual(['kept', 'kept', 'kept'])
    // The stamp names the first rung as the run's route and the whole ladder beside it.
    expect(report.stamp.model).toEqual(small)
    expect(report.stamp.ladder).toEqual([small, large, large])
    expect(StubAgents.current.created[0]?.agentOptions).toEqual({ provider: 'mock', model: 'small' })
    // The cell agent was left on the last rung, which is what a step entering
    // prompt assembly after it would have been routed to.
    await expect(applied(ctx)).resolves.toMatchObject(large)
  })

  it('leaves an unladdered run on its stamped route for every attempt', async () => {
    const { ctx, run } = await harness({ config: { maxAttempts: 2 } })
    StubShell.current.script(MARKER, shellResult({ exitCode: 1 }), shellResult())
    const report = await run({ model: { provider: 'other', model: 'candidate-7' } })

    expect(report.attempts.map(attempt => attempt.model))
      .toEqual([{ provider: 'other', model: 'candidate-7' }, { provider: 'other', model: 'candidate-7' }])
    await expect(applied(ctx)).resolves.toMatchObject({ provider: 'other', model: 'candidate-7' })
  })

  it('refuses a ladder no run could have, before any agent exists', async () => {
    const empty = await harness()
    await expect(empty.run({ ladder: [] })).rejects.toThrow(
      new EnvironmentRunError('an attempt ladder must name at least one rung', 'ENVIRONMENT_RUN_INVALID_LADDER'),
    )
    expect(StubAgents.current.created).toEqual([])

    const long = await harness({ config: { maxLadderRungs: 2 } })
    await expect(long.run({ ladder: [{}, {}, {}] })).rejects.toThrow(
      new EnvironmentRunError('an attempt ladder of 3 rungs exceeds the configured ceiling of 2', 'ENVIRONMENT_RUN_INVALID_LADDER'),
    )
    expect(StubAgents.current.created).toEqual([])
  })

  it('stamps the policy version and the seed, and samples every request of the cell with them', async () => {
    const { ctx, run } = await harness({ config: { topP: 0.9 } })
    StubShell.current.script(MARKER, shellResult())
    const report = await run({ policyVersion: 'policy-2026-09', seed: 12 })
    expect(report.stamp).toMatchObject({ policyVersion: 'policy-2026-09', seed: 12 })

    const proposed = { provider: 'mock', model: 'mock-default' }
    await expect(agentEvents(ctx, asAgent(StubAgents.current.agent)).waterfall(
      'agent/request',
      { turn: 1, step: 0, signal: new AbortController().signal },
      () => Promise.resolve(proposed),
    )).resolves.toEqual({ ...proposed, seed: 12, topP: 0.9 })
  })

  it('pins each scalar on its own, and refuses a seed no provider could be asked for', async () => {
    const proposed = { provider: 'mock', model: 'mock-default' }
    const sampled = (ctx: Context) => agentEvents(ctx, asAgent(StubAgents.current.agent)).waterfall(
      'agent/request',
      { turn: 1, step: 0, signal: new AbortController().signal },
      () => Promise.resolve(proposed),
    )

    const configured = await harness({ config: { topP: 0.1 } })
    StubShell.current.script(MARKER, shellResult())
    expect(await configured.run()).toMatchObject({ certified: true })
    expect(StubAgents.current.agent.session.events[0]?.data).not.toHaveProperty('seed')
    await expect(sampled(configured.ctx)).resolves.toEqual({ ...proposed, topP: 0.1 })

    const seeded = await harness()
    StubShell.current.script(MARKER, shellResult())
    expect(await seeded.run({ seed: 7 })).toMatchObject({ certified: true })
    await expect(sampled(seeded.ctx)).resolves.toEqual({ ...proposed, seed: 7 })

    const refusing = await harness()
    await expect(refusing.run({ seed: -1 })).rejects.toThrow(
      expect.objectContaining({ code: 'ENVIRONMENT_RUN_INVALID_SEED', message: 'seed must be a non-negative integer, got -1' }),
    )
    expect(StubAgents.current.created).toHaveLength(0)
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

  it('restores only the immutable paths before each validation, so an edit to any other fixture file reaches the checks', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'environment-fixture-'))
    await writeFile(join(fixture, 'seed.txt'), 'seed')
    await mkdir(join(fixture, 'tests'))
    await writeFile(join(fixture, 'tests', 'suite.sh'), 'exit 1\n')
    let workspace = ''
    const built = await harness({
      config: { maxAttempts: 2 },
      definition: environment({ task: { prompt: 'Extend the seed.', fixture, immutable: ['tests'] } }),
      onTurn: (turn, session) => {
        assistantTurns(turn, session)
        writeFileSync(join(workspace, 'seed.txt'), `edited on turn ${turn}`)
      },
    })
    workspace = built.workspace
    StubShell.current.script(MARKER, shellResult({ exitCode: 1 }), shellResult())
    const report = await built.run()

    // The seed is the implementer's to change; the suite is the validator's and stays.
    expect(await readFile(join(workspace, 'seed.txt'), 'utf8')).toBe('edited on turn 2')
    expect(await readFile(join(workspace, 'tests', 'suite.sh'), 'utf8')).toBe('exit 1\n')
    // Each validation digests the tree it ran on, edits included, so the two attempts differ.
    const hashes = report.attempts.map(attempt => attempt.treeHash)
    expect(new Set(hashes).size).toBe(2)
    expect(StubStandards.current.runs.map(run => run.evidence.treeHash)).toEqual(hashes)
  })

  it('records a tampered attempt, runs no check, issues the tamper directive, and ends the run', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'environment-fixture-'))
    await mkdir(join(fixture, 'tests'))
    await writeFile(join(fixture, 'tests', 'suite.sh'), 'exit 1\n')
    await writeFile(join(fixture, 'reference.txt'), 'expected\n')
    let workspace = ''
    const built = await harness({
      config: { maxAttempts: 2 },
      definition: environment({
        task: { prompt: 'Make the suite pass.', fixture, immutable: ['tests', 'reference.txt'] },
      }),
      onTurn: (turn, session) => {
        assistantTurns(turn, session)
        if (turn === 1) writeFileSync(join(workspace, 'tests', 'suite.sh'), 'exit 0\n')
      },
    })
    workspace = built.workspace
    // No scripted shell result: a tampered attempt must execute no check at all.
    const report = await built.run()

    expect(report.certified).toBe(false)
    expect(report.attempts).toEqual([{
      attempt: 1,
      model: { provider: 'mock', model: 'mock-default' },
      transcript: 'kept',
      results: [{
        checkId: 'marker',
        status: 'fail',
        evidence: 'not executed: the files this task is measured with were modified during the attempt',
      }],
      treeHash: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown as string,
    }])
    expect(StubShell.current.requests).toEqual([])
    expect(StubStandards.current.runs[0]?.evidence)
      .toEqual({ executor: 'runner', treeHash: report.attempts[0]?.treeHash, tampered: true })
    expect(StubStandards.current.directives).toEqual([{
      rootCause: 'the files this task is measured with were modified during the attempt',
      detail: 'Those files belong to the validator: the task is to make them pass, never to change them. This run is void and no certificate can follow it.',
    }])
    expect(StubAgents.current.agent.turns[1]).toBe(
      '<validation_failed>\nthe files this task is measured with were modified during the attempt\nThose files belong to the validator: the task is to make them pass, never to change them. This run is void and no certificate can follow it.\nContinue working on the task; the validator runs again when you stop.\n</validation_failed>',
    )
    expect(StubGoals.current.completed).toEqual([])
    expect(StubSessions.current.flushed).toBe(1)
    expect(StubAgents.current.disposed).toBe(1)
  })

  it('reads a deleted immutable path and a rewritten reservation as tamper, and an untouched set as no tamper', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'environment-fixture-'))
    await writeFile(join(fixture, 'reference.txt'), 'expected\n')
    const definition = environment({
      task: { prompt: 'Leave the reference alone.', fixture, immutable: ['reference.txt'] },
    })

    let workspace = ''
    const deleted = await harness({
      definition,
      onTurn: (turn, session) => {
        assistantTurns(turn, session)
        if (turn === 1) rmSync(join(workspace, 'reference.txt'))
      },
    })
    workspace = deleted.workspace
    await deleted.run()
    expect(StubStandards.current.runs.map(run => run.evidence.tampered)).toEqual([true])

    let reservation = ''
    const rewritten = await harness({
      barrierPrefix: 'environment-runner-tamper-barrier-',
      definition,
      onTurn: (turn, session) => {
        assistantTurns(turn, session)
        if (turn === 1) writeFileSync(join(reservation, 'checks', 'marker', 'run'), 'exit 0\n')
      },
    })
    reservation = join(rewritten.barrierRoot ?? '', 'runs', 'environment-test')
    await rewritten.run()
    expect(StubStandards.current.runs.map(run => run.evidence.tampered)).toEqual([true])

    const untouched = await harness({ definition })
    StubShell.current.script(MARKER, shellResult())
    const report = await untouched.run()
    expect(StubStandards.current.runs.map(run => run.evidence.tampered)).toEqual([undefined])
    expect(report.certified).toBe(true)
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
    // An immutable path the fixture does not supply, or one that names the reference.
    const fixture = await mkdtemp(join(tmpdir(), 'environment-fixture-'))
    await mkdir(join(fixture, 'reference'))
    StubEnvironments.current.definitions.set('smoke:marker', environment({ task: { prompt: 'p', fixture, immutable: ['tests'] } }))
    await reject({}, 'ENVIRONMENT_RUN_INVALID_FIXTURE')
    StubEnvironments.current.definitions.set('smoke:marker', environment({ task: { prompt: 'p', fixture, reference: 'reference', immutable: ['reference/expected.txt'] } }))
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

  it('resolves the implementer default, names it, and states its transcript interface, at the boundary', () => {
    const request = { environment: EnvironmentId('smoke:marker'), workspace: '/tmp' }
    expect(resolveImplementer(request)).toEqual({ kind: 'route' })
    const delegated = { kind: 'subagent', provider: 'claude-code' } as const
    expect(resolveImplementer({ ...request, implementer: delegated })).toBe(delegated)
    expect(implementerName({ kind: 'route' })).toBe('route')
    expect(implementerName(delegated)).toBe('claude-code')
    expect(implementerTranscript({ kind: 'route' })).toBe('kept')
    expect(implementerTranscript(delegated)).toBe('dropped')
  })

  it('resolves one rung per attempt and refuses a ladder no run could have, at the boundary', () => {
    const stamped = { provider: 'mock', model: 'small' }
    const large = { provider: 'mock', model: 'large' }
    expect(resolveLadder(undefined, stamped, 8)).toBeUndefined()
    expect(resolveLadder([{}, { model: large }, {}], stamped, 8)).toEqual([stamped, large, stamped])
    expect(() => resolveLadder([], stamped, 8)).toThrow(
      new EnvironmentRunError('an attempt ladder must name at least one rung', 'ENVIRONMENT_RUN_INVALID_LADDER'),
    )
    expect(() => resolveLadder([{}, {}, {}], stamped, 2)).toThrow(
      new EnvironmentRunError('an attempt ladder of 3 rungs exceeds the configured ceiling of 2', 'ENVIRONMENT_RUN_INVALID_LADDER'),
    )
  })

  it('resolves defaults once, at the boundary', () => {
    expect(resolveConfig({ isolation: 'host' })).toEqual({
      isolation: 'host', maxAttempts: 1, maxLadderRungs: 8, maxGoalRounds: undefined, checkTimeoutMs: undefined, evidenceMaxChars: 2000, maxFailedCases: 20, topP: undefined,
    })
    expect(resolveConfig({ isolation: 'none', maxAttempts: 3, maxLadderRungs: 4, maxGoalRounds: 5, checkTimeoutMs: 10, evidenceMaxChars: 50, maxFailedCases: 3, topP: 0.95 })).toEqual({
      isolation: 'none', maxAttempts: 3, maxLadderRungs: 4, maxGoalRounds: 5, checkTimeoutMs: 10, evidenceMaxChars: 50, maxFailedCases: 3, topP: 0.95,
    })
  })

  it('registers its empty invariant companion', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(invariantCompanion)).resolves.toBeDefined()
  })
})

describe('EnvironmentRunner delegated to an external implementer', () => {
  const SPAWN = { kind: 'subagent', provider: 'spawn' } as const

  it('starts one child per attempt, records each, and validates the tree the child left', async () => {
    const { run, workspace } = await harness({
      config: { maxAttempts: 2 },
      providers: { spawn: IN_PROCESS_CAPABILITIES },
    })
    StubSubagents.current.children = [
      { childUsage: { inputTokens: 21, outputTokens: 4 } },
      {
        result: { output: [], stopReason: 'completed', structured: { wrote: 'MARKER' } },
        childUsage: { inputTokens: 9, outputTokens: 2 },
        work: (directory) => { writeFileSync(join(directory, 'MARKER'), 'done\n') },
      },
    ]
    StubShell.current.script(MARKER, shellResult({ exitCode: 1, stderr: 'no MARKER\n' }), shellResult())
    const signal = new AbortController().signal
    const report = await run({ implementer: { ...SPAWN, label: 'external' }, signal })

    expect(report.certified).toBe(true)
    expect(report.stamp.implementer).toBe('spawn')
    // The cell agent implements nothing itself: no turn of its own is driven.
    expect(StubAgents.current.agent.turns).toEqual([])
    const starts = StubSubagents.current.started
    expect(starts.map(start => start.name)).toEqual(['spawn', 'spawn'])
    // The second child holds none of the first one's transcript, so its prompt
    // restates the task ahead of the directive.
    expect(starts.map(start => start.request.prompt)).toEqual([
      [{ type: 'text', text: 'Create a file named MARKER in the workspace.' }],
      [{ type: 'text', text: "Create a file named MARKER in the workspace.\n\n<validation_failed>\n1 of the standard's checks failed\n1. exit 1\nstderr: no MARKER\nContinue working on the task; the validator runs again when you stop.\n</validation_failed>" }],
    ])
    expect(starts[0]?.request).toMatchObject({ label: 'external', parent: StubAgents.current.agent })
    expect(StubSubagents.current.disposed).toBe(2)

    const delegations = StubAgents.current.agent.session.events.filter(event => event.type === 'environment/delegation')
    expect(delegations.map(event => event.data)).toEqual([
      { attempt: 1, restatedTask: false, provider: 'spawn', runId: 'child-1', stopReason: 'completed', usage: { inputTokens: 21, outputTokens: 4 } },
      {
        attempt: 2,
        restatedTask: true,
        provider: 'spawn',
        runId: 'child-2',
        stopReason: 'completed',
        structured: { wrote: 'MARKER' },
        usage: { inputTokens: 9, outputTokens: 2 },
      },
    ])
    // Both attempts are recorded as dropping the transcript, which is what the
    // fresh child per attempt makes them.
    expect(report.attempts.map(attempt => attempt.transcript)).toEqual(['dropped', 'dropped'])
    // The runner still executed the checks itself over the restored tree.
    expect(StubStandards.current.runs.map(recorded => recorded.evidence.executor)).toEqual(['runner', 'runner'])
    expect(StubShell.current.requests.map(request => request.workdir)).toEqual([workspace, workspace])
    // No assistant message reaches the cell log, so the run reports no usage of its own.
    expect(report).not.toHaveProperty('usage')
  })

  it('records a child that produced no local agent and delegates under a signal of its own', async () => {
    const { run } = await harness({ providers: { 'claude-code': PRODUCT_CAPABILITIES }, config: { isolation: 'none' } })
    StubSubagents.current.children = [{ result: { output: [], stopReason: 'refusal' } }]
    StubShell.current.script(MARKER, shellResult({ exitCode: 1 }))
    const report = await run({ implementer: { kind: 'subagent', provider: 'claude-code' } })

    expect(report.certified).toBe(false)
    expect(report.stamp.implementer).toBe('claude-code')
    expect(StubSubagents.current.started[0]?.request.signal.aborted).toBe(false)
    expect(StubSubagents.current.started[0]?.request).not.toHaveProperty('label')
    // A refusal is recorded and validated like any other ending; only the tree decides.
    expect(StubAgents.current.agent.session.events.filter(event => event.type === 'environment/delegation').map(event => event.data))
      .toEqual([{ attempt: 1, restatedTask: false, provider: 'claude-code', runId: 'child-1', stopReason: 'refusal' }])
  })

  it('starts every child on the stamped model and records what the child reported running and spending', async () => {
    const { run } = await harness({
      config: { maxAttempts: 2, isolation: 'none' },
      providers: { 'claude-code': PRODUCT_CAPABILITIES },
    })
    StubSubagents.current.children = [
      {
        result: {
          output: [],
          stopReason: 'completed',
          reportedModel: 'product-sonnet-2026-01',
          reportedUsage: { inputTokens: 31, outputTokens: 7 },
          reportedCostUsd: 0.0412,
        },
      },
      { result: { output: [], stopReason: 'error' }, work: (directory) => { writeFileSync(join(directory, 'MARKER'), 'done\n') } },
    ]
    StubShell.current.script(MARKER, shellResult({ exitCode: 1 }), shellResult())
    const report = await run({
      implementer: { kind: 'subagent', provider: 'claude-code' },
      model: { provider: 'claude-code', model: 'sonnet' },
    })

    expect(report.stamp.model).toEqual({ provider: 'claude-code', model: 'sonnet' })
    // The arm the cell is published under is the arm every child was started on.
    expect(StubSubagents.current.started.map(start => start.request.model)).toEqual(['sonnet', 'sonnet'])
    // The alias asked for and the version the product answered with are separate
    // facts, and the product's own accounting is the only spend recorded here.
    expect(StubAgents.current.agent.session.events.filter(event => event.type === 'environment/delegation').map(event => event.data)).toEqual([
      {
        attempt: 1,
        restatedTask: false,
        provider: 'claude-code',
        runId: 'child-1',
        stopReason: 'completed',
        reportedModel: 'product-sonnet-2026-01',
        reportedUsage: { inputTokens: 31, outputTokens: 7 },
        reportedCostUsd: 0.0412,
      },
      { attempt: 2, restatedTask: true, provider: 'claude-code', runId: 'child-2', stopReason: 'error' },
    ])
    // The cell drove no turn of its own, so its own session accounts for nothing.
    expect(report).not.toHaveProperty('usage')
  })

  it('starts each child on its own rung and restates the task for the one that follows a directive', async () => {
    const { run } = await harness({
      config: { maxAttempts: 1 },
      providers: { spawn: IN_PROCESS_CAPABILITIES },
    })
    StubShell.current.script(MARKER, shellResult({ exitCode: 1, stderr: 'no MARKER\n' }), shellResult())
    const report = await run({
      implementer: SPAWN,
      model: { provider: 'mock', model: 'small' },
      ladder: [{}, { model: { provider: 'mock', model: 'large' } }],
    })

    expect(report.certified).toBe(true)
    expect(report.attempts.map(attempt => [attempt.model.model, attempt.transcript]))
      .toEqual([['small', 'dropped'], ['large', 'dropped']])
    // Each child is started on its own rung's model id; the rung's harness
    // provider is what the stamp records, never what a provider is told.
    expect(StubSubagents.current.started.map(start => start.request.model)).toEqual(['small', 'large'])
    expect(StubSubagents.current.started[1]?.request.prompt).toEqual([{
      type: 'text',
      text: "Create a file named MARKER in the workspace.\n\n<validation_failed>\n1 of the standard's checks failed\n1. exit 1\nstderr: no MARKER\nContinue working on the task; the validator runs again when you stop.\n</validation_failed>",
    }])
    expect(StubAgents.current.agent.session.events
      .filter(event => event.type === 'environment/delegation')
      .map(event => [event.data.attempt, event.data.restatedTask]))
      .toEqual([[1, false], [2, true]])
  })

  it('forwards the composition default when the request names no model', async () => {
    const { run } = await harness({ providers: { spawn: IN_PROCESS_CAPABILITIES } })
    StubShell.current.script(MARKER, shellResult())
    await run({ implementer: SPAWN })
    expect(StubSubagents.current.started[0]?.request.model).toBe('mock-default')
  })

  it('refuses a provider that cannot be told which model to run, before any agent exists', async () => {
    const { run } = await harness({ providers: { codex: NO_START_CAPABILITIES }, config: { isolation: 'none' } })
    await expect(run({ implementer: { kind: 'subagent', provider: 'codex' } })).rejects.toThrow(new EnvironmentRunError(
      'implementer provider "codex" cannot be told which model to run, so a run stamped with model "mock-default" would measure whichever model that provider defaults to',
      'ENVIRONMENT_RUN_IMPLEMENTER_MODEL_UNSUPPORTED',
    ))
    expect(StubAgents.current.created).toEqual([])
  })

  it('ends a tampered delegated attempt without starting another child', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'environment-delegated-tamper-'))
    await writeFile(join(fixture, 'reference.txt'), 'expected\n')
    const built = await harness({
      config: { maxAttempts: 2 },
      providers: { spawn: IN_PROCESS_CAPABILITIES },
      definition: environment({
        task: { prompt: 'Leave the reference alone.', fixture, immutable: ['reference.txt'] },
      }),
    })
    StubSubagents.current.children = [{ work: (directory) => { writeFileSync(join(directory, 'reference.txt'), 'rewritten\n') } }]
    const report = await built.run({ implementer: SPAWN })

    expect(report.certified).toBe(false)
    expect(StubStandards.current.runs[0]?.evidence.tampered).toBe(true)
    expect(StubStandards.current.directives).toEqual([{
      rootCause: 'the files this task is measured with were modified during the attempt',
      detail: 'Those files belong to the validator: the task is to make them pass, never to change them. This run is void and no certificate can follow it.',
    }])
    // The directive is the whole record: no follow-up turn and no second child.
    expect(StubAgents.current.agent.turns).toEqual([])
    expect(StubSubagents.current.started).toHaveLength(1)
  })

  it('refuses a provider the composition does not hold, before any agent exists', async () => {
    const bare = await harness()
    await expect(bare.run({ implementer: SPAWN })).rejects.toThrow(new EnvironmentRunError(
      'implementer provider "spawn" is unavailable: this composition has no subagent service',
      'ENVIRONMENT_RUN_IMPLEMENTER_UNAVAILABLE',
    ))
    expect(StubAgents.current.created).toEqual([])

    const composed = await harness({ providers: { spawn: IN_PROCESS_CAPABILITIES } })
    await expect(composed.run({ implementer: { kind: 'subagent', provider: 'absent' } })).rejects.toThrow(new EnvironmentRunError(
      'implementer provider "absent" is unavailable: no subagent provider is registered under that name',
      'ENVIRONMENT_RUN_IMPLEMENTER_UNAVAILABLE',
    ))
    expect(StubAgents.current.created).toEqual([])
  })

  it('refuses an out-of-process provider under an isolation the census cannot back', async () => {
    for (const isolation of ['process', 'host'] as const) {
      const { run } = await harness({ config: { isolation }, providers: { 'claude-code': NO_START_CAPABILITIES } })
      await expect(run({ implementer: { kind: 'subagent', provider: 'claude-code' } })).rejects.toThrow(new EnvironmentRunError(
        `implementer provider "claude-code" runs outside this process, where the read-barrier census cannot confine it, so it cannot implement a run declaring "${isolation}" isolation`,
        'ENVIRONMENT_RUN_IMPLEMENTER_UNCONFINED',
      ))
      expect(StubAgents.current.created).toEqual([])
    }

    // An in-process provider keeps the deployment's own isolation, so the same
    // claim is not refused for it.
    const { run } = await harness({ providers: { spawn: IN_PROCESS_CAPABILITIES } })
    StubShell.current.script(MARKER, shellResult())
    expect((await run({ implementer: SPAWN })).certified).toBe(true)
  })

  it('stamps the route implementer for a run that names none', async () => {
    const { run } = await harness()
    StubShell.current.script(MARKER, shellResult())
    const report = await run()
    expect(report.stamp.implementer).toBe('route')
    expect(StubAgents.current.agent.turns).toHaveLength(1)
  })
})

describe('EnvironmentRunner delegated cell budgets', () => {
  const SPAWN = { kind: 'subagent', provider: 'spawn' } as const
  const PRODUCT = { kind: 'subagent', provider: 'claude-code' } as const

  /** The budget records one cell session carries, in log order. */
  function budgetEvents(type: 'budget/breach' | 'usage/foreign'): unknown[] {
    return StubAgents.current.agent.session.events.filter(event => event.type === type).map(event => event.data)
  }

  it('refuses a delegated run no budget policy could bound, before any agent exists', async () => {
    const { run } = await harness({ providers: { spawn: IN_PROCESS_CAPABILITIES }, unbudgeted: true })
    await expect(run({ implementer: SPAWN })).rejects.toThrow(new EnvironmentRunError(
      'implementer provider "spawn" does the work of its attempts outside this session\'s own model route, where only the budget policy\'s caps can bound it, and this composition has none',
      'ENVIRONMENT_RUN_IMPLEMENTER_UNBOUNDED',
    ))
    expect(StubAgents.current.created).toEqual([])
    expect(StubSubagents.current.started).toEqual([])

    // A route cell reaches the policy's own pre-step check whenever one is
    // composed, so a deployment composing none has chosen no budgets.
    StubShell.current.script(MARKER, shellResult())
    expect((await run()).certified).toBe(true)
  })

  it('charges what the child reported and blocks the attempts the token cap did not pay for', async () => {
    const { run } = await harness({
      config: { maxAttempts: 3, isolation: 'none' },
      providers: { 'claude-code': PRODUCT_CAPABILITIES },
      budget: { maxTotalTokens: 30, foreignCostEurPerUsd: 0.5 },
    })
    StubSubagents.current.children = [{
      result: {
        output: [],
        stopReason: 'completed',
        reportedUsage: { inputTokens: 20, outputTokens: 6, cacheReadTokens: 5 },
        reportedCostUsd: 3,
      },
    }]
    StubShell.current.script(MARKER, shellResult({ exitCode: 1 }))
    const report = await run({ implementer: PRODUCT })

    expect(budgetEvents('usage/foreign')).toEqual([
      { ref: 'child-1', source: 'claude-code', inputTokens: 25, outputTokens: 6, costEur: 1.5 },
    ])
    expect(budgetEvents('budget/breach')).toEqual([{ cap: 'maxTotalTokens', measured: 31, limit: 30 }])
    // One child ran; the two attempts its spend did not pay for never started,
    // and the tree the blocked attempt would have left is never measured twice.
    expect(StubSubagents.current.started).toHaveLength(1)
    expect(StubStandards.current.runs).toHaveLength(1)
    expect(report.attempts).toHaveLength(1)
    expect(report.certified).toBe(false)
    expect(report.caps).toEqual([['maxTotalTokens', 30]])
  })

  it('completes a cell that certified on the attempt that exhausted its budget', async () => {
    const { run } = await harness({
      config: { maxAttempts: 2, isolation: 'none' },
      providers: { 'claude-code': PRODUCT_CAPABILITIES },
      budget: { maxTotalTokens: 5 },
    })
    StubSubagents.current.children = [{
      result: { output: [], stopReason: 'completed', reportedUsage: { inputTokens: 40, outputTokens: 8 } },
    }]
    StubShell.current.script(MARKER, shellResult())
    const report = await run({ implementer: PRODUCT })

    // The budget is measured before an attempt, exactly as the pre-step check
    // is, so the work already done still certifies and nothing blocks the goal.
    expect(report.certified).toBe(true)
    expect(budgetEvents('budget/breach')).toEqual([])
    expect(StubGoals.current.blocked).toEqual([])
    expect(StubGoals.current.completed).toHaveLength(1)
  })

  it('charges an in-process child through the log this process does keep', async () => {
    const { run } = await harness({
      config: { maxAttempts: 2 },
      providers: { spawn: IN_PROCESS_CAPABILITIES },
      budget: { maxTotalTokens: 20 },
    })
    StubSubagents.current.children = [{ childUsage: { inputTokens: 18, outputTokens: 4 } }]
    StubShell.current.script(MARKER, shellResult({ exitCode: 1 }))
    await run({ implementer: SPAWN })

    expect(budgetEvents('usage/foreign')).toEqual([
      { ref: 'child-1', source: 'spawn', inputTokens: 18, outputTokens: 4 },
    ])
    expect(budgetEvents('budget/breach')).toEqual([{ cap: 'maxTotalTokens', measured: 22, limit: 20 }])
    expect(StubSubagents.current.started).toHaveLength(1)
  })

  it('ends an attempt at the wall deadline, records it as the budget deadline, and blocks the rest', async () => {
    const { run } = await harness({
      config: { maxAttempts: 3, isolation: 'none' },
      providers: { 'claude-code': PRODUCT_CAPABILITIES },
      budget: { maxWallMs: 0 },
    })
    StubSubagents.current.children = [{ untilAborted: true, result: { output: [], stopReason: 'aborted' } }]
    StubShell.current.script(MARKER, shellResult({ exitCode: 1 }))
    const report = await run({ implementer: PRODUCT })

    // The child settled because the cell's own deadline cancelled it, which is
    // recorded apart from the cancellation an operator would cause.
    expect(StubAgents.current.agent.session.events.filter(event => event.type === 'environment/delegation').map(event => event.data))
      .toEqual([{ attempt: 1, restatedTask: false, provider: 'claude-code', runId: 'child-1', stopReason: 'budget-deadline' }])
    const [breach] = budgetEvents('budget/breach') as { cap: string; limit: number }[]
    expect(breach).toMatchObject({ cap: 'maxWallMs', limit: 0 })
    expect(StubGoals.current.blocked).toHaveLength(1)
    expect(StubSubagents.current.started).toHaveLength(1)
    expect(report.certified).toBe(false)
  })

  it('takes a start its own deadline cancelled as the end of the attempt, and rethrows any other failure', async () => {
    const deadlined = await harness({
      config: { isolation: 'none' },
      providers: { 'claude-code': PRODUCT_CAPABILITIES },
      budget: { maxWallMs: 0 },
    })
    StubSubagents.current.children = [{ failsToStart: true }]
    StubShell.current.script(MARKER, shellResult({ exitCode: 1 }))
    // A child the deadline cancelled before it started leaves no delegation
    // record; the run still ends at the validation of the tree it never touched.
    await expect(deadlined.run({ implementer: PRODUCT })).resolves.toMatchObject({ certified: false })
    expect(StubAgents.current.agent.session.events.filter(event => event.type === 'environment/delegation')).toEqual([])

    const failing = await harness({ config: { isolation: 'none' }, providers: { 'claude-code': PRODUCT_CAPABILITIES } })
    StubSubagents.current.children = [{ failsToStart: true }]
    const request = failing.run({ implementer: PRODUCT, signal: AbortSignal.abort() })
    await expect(request).rejects.toThrow('stub-subagents: the run was cancelled before startup')
  })

  it('blocks the first attempt of a cell whose budget is already spent', async () => {
    const { run } = await harness({
      config: { maxAttempts: 2, isolation: 'none' },
      providers: { 'claude-code': PRODUCT_CAPABILITIES },
      budget: { maxTotalTokens: 0 },
    })
    StubShell.current.script(MARKER, shellResult({ exitCode: 1 }))
    StubAgents.current.agent = new FakeAgent('spent-cell', assistantTurns)
    StubAgents.current.agent.session.append('usage/foreign', { ref: 'earlier', source: 'claude-code', inputTokens: 1, outputTokens: 0 })
    const report = await run({ implementer: PRODUCT })

    expect(StubSubagents.current.started).toEqual([])
    expect(budgetEvents('budget/breach')).toEqual([{ cap: 'maxTotalTokens', measured: 1, limit: 0 }])
    expect(report.certified).toBe(false)
  })

  it('answers the caps one cell of an arm runs under, dropping a cost cap it cannot measure for a delegated one', async () => {
    const priced = {
      maxTotalTokens: 100,
      maxCostEur: 5,
      pricing: { 'mock/mock-default': { inputEurPerMillionTokens: 1, outputEurPerMillionTokens: 2 } },
    }
    const unconvertible = await harness({ providers: { spawn: IN_PROCESS_CAPABILITIES }, budget: priced })
    expect(unconvertible.ctx.environmentRuns.cellCaps({ kind: 'route' }))
      .toEqual([['maxTotalTokens', 100], ['maxCostEur', 5]])
    expect(unconvertible.ctx.environmentRuns.cellCaps(SPAWN)).toEqual([['maxTotalTokens', 100]])

    const convertible = await harness({
      providers: { spawn: IN_PROCESS_CAPABILITIES },
      budget: { ...priced, foreignCostEurPerUsd: 0.9 },
    })
    expect(convertible.ctx.environmentRuns.cellCaps(SPAWN)).toEqual([['maxTotalTokens', 100], ['maxCostEur', 5]])

    // Without a policy a route cell is simply uncapped, and a delegated one is refused.
    const bare = await harness({ providers: { spawn: IN_PROCESS_CAPABILITIES }, unbudgeted: true })
    expect(bare.ctx.environmentRuns.cellCaps({ kind: 'route' })).toEqual([])
    expect(() => bare.ctx.environmentRuns.cellCaps(SPAWN)).toThrow(EnvironmentRunError)
  })

  it('reports the caps of a route cell and leaves a run under no wall cap uncancelled', async () => {
    const { run, ctx } = await harness({
      providers: { spawn: IN_PROCESS_CAPABILITIES },
      budget: { maxTotalTokens: 1_000 },
    })
    StubShell.current.script(MARKER, shellResult())
    expect((await run({ implementer: SPAWN })).caps).toEqual([['maxTotalTokens', 1_000]])
    // No wall cap arms no deadline, so the child's signal only follows the run's.
    expect(StubSubagents.current.started[0]?.request.signal.aborted).toBe(false)
    expect(ctx.environmentRuns.cellCaps(SPAWN)).toEqual([['maxTotalTokens', 1_000]])
  })
})

describe('EnvironmentRunner.checkImplementer', () => {
  const SPAWN = { kind: 'subagent', provider: 'spawn' } as const
  const MODEL = { provider: 'mock', model: 'mock-default' }

  /** Ask one composition's runner about one implementer, as a planner does. */
  function check(ctx: Context, implementer: EnvironmentRunImplementer, model = MODEL): () => void {
    return () => { ctx.environmentRuns.checkImplementer(implementer, model) }
  }

  it('raises every refusal a run raises, without creating an agent', async () => {
    const bare = await harness()
    expect(check(bare.ctx, SPAWN)).toThrow(new EnvironmentRunError(
      'implementer provider "spawn" is unavailable: this composition has no subagent service',
      'ENVIRONMENT_RUN_IMPLEMENTER_UNAVAILABLE',
    ))

    const composed = await harness({ providers: { spawn: IN_PROCESS_CAPABILITIES } })
    expect(check(composed.ctx, { kind: 'subagent', provider: 'absent' })).toThrow(new EnvironmentRunError(
      'implementer provider "absent" is unavailable: no subagent provider is registered under that name',
      'ENVIRONMENT_RUN_IMPLEMENTER_UNAVAILABLE',
    ))

    const confined = await harness({ config: { isolation: 'host' }, providers: { 'claude-code': PRODUCT_CAPABILITIES } })
    expect(check(confined.ctx, { kind: 'subagent', provider: 'claude-code' })).toThrow(new EnvironmentRunError(
      'implementer provider "claude-code" runs outside this process, where the read-barrier census cannot confine it, so it cannot implement a run declaring "host" isolation',
      'ENVIRONMENT_RUN_IMPLEMENTER_UNCONFINED',
    ))

    const unroutable = await harness({ config: { isolation: 'none' }, providers: { codex: NO_START_CAPABILITIES } })
    expect(check(unroutable.ctx, { kind: 'subagent', provider: 'codex' }, { provider: 'mock', model: 'large' })).toThrow(new EnvironmentRunError(
      'implementer provider "codex" cannot be told which model to run, so a run stamped with model "large" would measure whichever model that provider defaults to',
      'ENVIRONMENT_RUN_IMPLEMENTER_MODEL_UNSUPPORTED',
    ))

    const unbudgeted = await harness({ providers: { spawn: IN_PROCESS_CAPABILITIES }, unbudgeted: true })
    expect(check(unbudgeted.ctx, SPAWN)).toThrow(new EnvironmentRunError(
      'implementer provider "spawn" does the work of its attempts outside this session\'s own model route, where only the budget policy\'s caps can bound it, and this composition has none',
      'ENVIRONMENT_RUN_IMPLEMENTER_UNBOUNDED',
    ))

    expect(StubAgents.current.created).toEqual([])
    expect(StubSubagents.current.started).toEqual([])
  })

  it('accepts a composed provider and the session\'s own route', async () => {
    const { ctx } = await harness({ providers: { spawn: IN_PROCESS_CAPABILITIES } })
    expect(check(ctx, SPAWN)).not.toThrow()

    // A route implementer is what a run without one already uses, so an
    // unbudgeted composition refuses it nothing either.
    const bare = await harness({ unbudgeted: true })
    expect(check(bare.ctx, { kind: 'route' })).not.toThrow()
  })
})

const digest = (text: string, normalizers: readonly CheckCaseNormalizer[] = []): string =>
  caseChannelDigest(Buffer.from(text, 'utf8'), normalizers)

/** Digest of a directory holding no regular file, which an emptied `treeScope` always has. */
const EMPTY_TREE = createHash('sha256').digest('hex')

const REVERSE = 'node reverse.js'

/** One case of the `reverses-lines` check, addressed by the argv word it appends. */
function sample(id: string, rest: Partial<CheckCase> = {}): CheckCase {
  return {
    id: CheckCaseId(id),
    weight: 1,
    input: { argv: [`--${id}`] },
    expected: { stdoutSha256: digest('expected\n') },
    comparator: { channels: ['stdout'], normalizers: ['crlf'] },
    ...rest,
  }
}

/** An environment whose one check carries the given cases. */
function casedEnvironment(bodies: readonly CheckCase[], rest: Partial<AuthoredCheck> = {}): EnvironmentDefinition {
  return environment({
    checks: [{
      id: CheckId('reverses-lines'),
      outcome: 'the program reverses each line',
      run: REVERSE,
      cases: checkCasesRef(bodies),
      caseBodies: bodies,
      ...rest,
    }],
  })
}

describe('the shared four-channel capture', () => {
  it('carries the run\'s per-case timeout and cancellation into every case command', async () => {
    const bodies: CheckCase[] = [sample('crlf-ok')]
    const { run } = await harness({
      config: { checkTimeoutMs: 250 },
      definition: casedEnvironment(bodies),
    })
    StubShell.current.script(`${REVERSE} --crlf-ok`, shellResult({ stdout: 'expected\n' }))
    const signal = new AbortController().signal
    await run({ signal })

    expect(StubShell.current.requests.at(-1))
      .toMatchObject({ command: `${REVERSE} --crlf-ok`, timeoutMs: 250, signal })
  })

  it('records an expected value only for a channel the reference could put one on', async () => {
    const scope = await mkdtemp(join(tmpdir(), 'environment-runner-expectation-'))
    const clean = await caseExpectation(
      { result: shellResult({ exitCode: 3, stdout: 'out\r\n', stderr: 'err\n' }), scope },
      { channels: ['exit', 'stdout', 'stderr', 'tree'], normalizers: ['crlf'] },
    )

    expect(clean).toEqual({
      exitCode: 3,
      stdoutSha256: digest('out\n'),
      stderrSha256: digest('err\n'),
      treeSha256: await hashWorkspaceTree(scope, ['crlf']),
    })

    // A signalled exit and a truncated stream leave their channels unrecorded,
    // which is what the instrument refuses a case over.
    const unusable = await caseExpectation(
      {
        result: {
          ...shellResult(),
          exitCode: null,
          stdout: { text: 'clipped', truncated: true },
          stderr: { text: 'also clipped', truncated: true },
        },
      },
      { channels: ['exit', 'stdout', 'stderr'], normalizers: [] },
    )

    expect(unusable).toEqual({})
  })
})

describe('EnvironmentRunner weighted cases', () => {
  it('runs one case per sample, compares four channels, and tallies the weights', async () => {
    const bodies: CheckCase[] = [
      // Passing: the normalizer folds the candidate's CRLF before the digest.
      sample('crlf-ok'),
      // Failing on stdout alone, exiting zero.
      sample('stdout-a', { weight: 2 }),
      // Failing on stdout alone, exiting zero: the same cluster as stdout-a.
      sample('stdout-b', { weight: 3 }),
      // Failing on stderr, exiting non-zero: its own cluster.
      sample('stderr-x', {
        weight: 4,
        expected: { stderrSha256: digest('') },
        comparator: { channels: ['stderr'], normalizers: [] },
      }),
      // Passing on every configured channel at once.
      sample('all-clear', {
        weight: 5,
        input: { argv: ['--all-clear'], stdin: 'seed\n', files: { 'in/data.txt': 'staged' } },
        expected: { exitCode: 0, stdoutSha256: digest('done\n'), stderrSha256: digest(''), treeSha256: EMPTY_TREE },
        comparator: { channels: ['exit', 'stdout', 'stderr', 'tree'], normalizers: [] },
      }),
    ]
    let workspace = ''
    const built = await harness({
      definition: casedEnvironment(bodies, { treeScope: 'out' }),
      onTurn: (turn, session) => {
        assistantTurns(turn, session)
        // The runner empties the tree scope before each case, so this file
        // never reaches the digest the `all-clear` case compares.
        mkdirSync(join(workspace, 'out'), { recursive: true })
        writeFileSync(join(workspace, 'out', 'leftover.txt'), 'stale')
      },
    })
    workspace = built.workspace
    const shell = StubShell.current
    shell.script(`${REVERSE} --crlf-ok`, shellResult({ stdout: 'expected\r\n' }))
    shell.script(`${REVERSE} --stdout-a`, shellResult({ stdout: 'wrong\n' }))
    shell.script(`${REVERSE} --stdout-b`, shellResult({ stdout: 'other\n' }))
    shell.script(`${REVERSE} --stderr-x`, shellResult({ exitCode: 1, stderr: 'boom\n' }))
    shell.script(`${REVERSE} --all-clear`, shellResult({ stdout: 'done\n' }))
    const report = await built.run()

    const result = report.attempts[0]?.results[0]
    expect(result?.status).toBe('fail')
    expect(result?.cases).toEqual({
      passed: 2,
      total: 5,
      weightPassed: 6,
      weightTotal: 15,
      failed: [
        { id: 'stdout-a', weight: 2, channels: ['stdout'], exitClass: 'zero' },
        { id: 'stdout-b', weight: 3, channels: ['stdout'], exitClass: 'zero' },
        { id: 'stderr-x', weight: 4, channels: ['stderr'], exitClass: 'nonzero' },
      ],
    })
    expect(result?.evidence).toBe([
      'cases: 2 of 5 passed (weight 6 of 15)',
      'case "stdout-a" differed on stdout; exit 0',
      'stdout: wrong',
      'case "stdout-b" differed on stdout; exit 0',
      'stdout: other',
      'case "stderr-x" differed on stderr; exit 1',
      'stderr: boom',
    ].join('\n'))
    // The case that stages files and stdin resolves them through the executor.
    expect(shell.requests.at(-1)).toMatchObject({ command: `${REVERSE} --all-clear`, stdin: 'seed\n' })
    expect(await readFile(join(workspace, 'in', 'data.txt'), 'utf8')).toBe('staged')
    expect(report.certified).toBe(false)
  })

  it('builds the directive from clusters and names no captured output', async () => {
    const sentinel = 'SENTINEL-EXPECTED-OUTPUT'
    const bodies: CheckCase[] = [
      sample('stdout-a', { weight: 2 }),
      sample('stdout-b', { weight: 3 }),
      sample('stderr-x', {
        weight: 4,
        expected: { stderrSha256: digest('') },
        comparator: { channels: ['stderr'], normalizers: [] },
      }),
    ]
    const definition = casedEnvironment(bodies)
    const { run } = await harness({
      config: { maxAttempts: 2 },
      definition: {
        ...definition,
        checks: [...definition.checks, { id: CheckId('builds'), outcome: 'the build succeeds', run: 'make' }],
      },
    })
    // Two attempts run every command twice.
    const shell = StubShell.current
    const twice = (result: ShellRunResult): [ShellRunResult, ShellRunResult] => [result, result]
    shell.script(`${REVERSE} --stdout-a`, ...twice(shellResult({ stdout: 'wrong\n' })))
    shell.script(`${REVERSE} --stdout-b`, ...twice(shellResult({ stdout: 'other\n' })))
    shell.script(`${REVERSE} --stderr-x`, ...twice(shellResult({ exitCode: 1, stderr: `expected: ${sentinel}\n` })))
    shell.script('make', ...twice(shellResult({ exitCode: 2, stderr: `make: expected ${sentinel}\n` })))
    const report = await run()

    const directive = StubStandards.current.directives[0]
    expect(directive?.rootCause).toBe("2 of the standard's checks failed")
    expect(directive?.detail).toBe([
      '1. the program reverses each line: 2 of 3 cases failed (weight 5 of 9); mismatching channels: stdout; the program exited 0',
      '2. the program reverses each line: 1 of 3 cases failed (weight 4 of 9); mismatching channels: stderr; the program exited non-zero',
      '3. exit 2',
      `stderr: make: expected ${sentinel}`,
    ].join('\n'))
    expect(directive?.clusters).toEqual([
      { checkId: 'reverses-lines', channels: ['stdout'], count: 2, weight: 5 },
      { checkId: 'reverses-lines', channels: ['stderr'], count: 1, weight: 4 },
    ])
    // The validator's own expected output reaches the durable run evidence and
    // never the directive line built from the cased check's clusters.
    const casedEvidence = report.attempts[0]?.results[0]?.evidence ?? ''
    expect(casedEvidence).toContain(sentinel)
    expect(directive?.detail.split('\n').slice(0, 2).join('\n')).not.toContain(sentinel)
  })

  it('classifies a timeout, a signal, and a truncated stream, and bounds the failed list', async () => {
    const bodies: CheckCase[] = [
      sample('slow'),
      sample('killed'),
      sample('truncated'),
      sample('exit-only', { expected: { exitCode: 0 }, comparator: { channels: ['exit'], normalizers: [] } }),
    ]
    const { run } = await harness({ config: { maxFailedCases: 2 }, definition: casedEnvironment(bodies) })
    const shell = StubShell.current
    shell.script(`${REVERSE} --slow`, shellResult({ exitCode: null, signal: 'SIGKILL', timedOut: true, timeoutMs: 250 }))
    shell.script(`${REVERSE} --killed`, shellResult({ exitCode: null, signal: 'SIGTERM' }))
    shell.script(`${REVERSE} --truncated`, { ...shellResult(), stdout: { text: 'expected\n', truncated: true } })
    shell.script(`${REVERSE} --exit-only`, shellResult({ exitCode: 3 }))
    const report = await run()

    const cases = report.attempts[0]?.results[0]?.cases
    expect(cases).toMatchObject({ passed: 0, total: 4, weightPassed: 0, weightTotal: 4 })
    expect(cases?.failed).toEqual([
      { id: 'slow', weight: 1, channels: ['stdout'], exitClass: 'timeout' },
      { id: 'killed', weight: 1, channels: ['stdout'], exitClass: 'signal' },
    ])
    expect(StubStandards.current.directives[0]?.clusters).toEqual([
      { checkId: 'reverses-lines', channels: ['stdout'], count: 1, weight: 1 },
      { checkId: 'reverses-lines', channels: ['stdout'], count: 1, weight: 1 },
    ])
  })

  it('empties the tree scope before each case and reports a tree mismatch', async () => {
    const bodies: CheckCase[] = [
      sample('tree-clean', {
        expected: { treeSha256: EMPTY_TREE },
        comparator: { channels: ['tree'], normalizers: ['crlf'] },
      }),
      sample('tree-dirty', {
        weight: 2,
        expected: { treeSha256: 'c'.repeat(64) },
        comparator: { channels: ['tree'], normalizers: [] },
      }),
    ]
    const { run } = await harness({ definition: casedEnvironment(bodies, { treeScope: 'out/artifacts' }) })
    StubShell.current.script(`${REVERSE} --tree-clean`, shellResult())
    StubShell.current.script(`${REVERSE} --tree-dirty`, shellResult())
    const report = await run()
    expect(report.attempts[0]?.results[0]?.cases).toMatchObject({
      passed: 1,
      weightPassed: 1,
      failed: [{ id: 'tree-dirty', weight: 2, channels: ['tree'], exitClass: 'zero' }],
    })
  })

  it('writes each check its own reserved directory with its run script and case bodies', async () => {
    const bodies = [sample('crlf-ok')]
    const { run, barrierRoot } = await harness({
      barrierPrefix: 'environment-runner-cases-',
      definition: casedEnvironment(bodies),
    })
    const directory = join(barrierRoot ?? '', 'runs', 'environment-test', 'checks', 'reverses-lines')
    StubShell.current.script(`. ${join(directory, 'run')} --crlf-ok`, shellResult({ stdout: 'expected\n' }))
    const report = await run()
    expect(report.certified).toBe(true)
    // The script is sourced once per case with that case's argv as its positional
    // parameters, so it forwards them; without "$@" every case would run the bare command.
    expect(await readFile(join(directory, 'run'), 'utf8')).toBe(`${REVERSE} "$@"\n`)
    expect(await readFile(join(directory, 'cases.jsonl'), 'utf8')).toBe(`${JSON.stringify(bodies[0])}\n`)
  })
})
