/**
 * The instrument's own contract: what each verb records, what it refuses, and
 * what a validator reads back from it.
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { GoalId } from '@deepseek-ai/dsh-goal'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { ShellExecRequest, ShellExecSpec, ShellRunResult } from '@deepseek-ai/dsh-shell'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { StandardId } from '@deepseek-ai/dsh-verification'
import type { AuthoredCheck, StandardRef, StandardView } from '@deepseek-ai/dsh-verification'
import * as toolStandardAuthor from '@deepseek-ai/dsh-tool-standard-author'
import { DEFAULT_CHECK_RUN, STANDARD_AUTHOR_AUTHORITY } from '@deepseek-ai/dsh-tool-standard-author'
import * as invariantCompanion from '@deepseek-ai/dsh-tool-standard-author/invariant'

const signal = new AbortController().signal

/** One registry-compatible live agent whose session the instrument authors into. */
function stubAgent(rawId: string): Agent {
  const session = Session.create(SessionId(rawId))
  const status: AgentStatus = 'running'
  return {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    get status() { return status },
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject(input) { this.inbox.append('next-step', input) },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
}

/** The reservation the stub barrier hands out, or nothing when the session holds none. */
class StubReadBarrier extends Service {
  static current: StubReadBarrier
  reservation_: string | undefined
  constructor(ctx: Context) {
    super(ctx, 'readBarrier')
    StubReadBarrier.current = this
  }

  reservation(): string | undefined {
    return this.reservation_
  }
}

class StubGoals extends Service {
  static current: StubGoals
  goal: GoalView | undefined = {
    id: GoalId('goal-1'),
    revision: 1,
    objective: 'recreate the reference',
    phase: 'active',
    maxGoalRounds: 8,
    roundsStarted: 0,
    createdAt: 1,
    updatedAt: 1,
    activation: 'disarmed',
  }

  constructor(ctx: Context) {
    super(ctx, 'goals')
    StubGoals.current = this
  }

  get(): GoalView | undefined {
    return this.goal
  }
}

class StubStandards extends Service {
  static current: StubStandards
  readonly authored: AuthoredCheck[][] = []
  readonly extended: { ref: StandardRef; checks: AuthoredCheck[] }[] = []
  view: StandardView | undefined
  constructor(ctx: Context) {
    super(ctx, 'completionStandards')
    StubStandards.current = this
  }

  author(_agent: Agent, request: { goalId: GoalView['id']; checks: readonly AuthoredCheck[] }): StandardView {
    this.authored.push([...request.checks])
    this.view = {
      id: StandardId('standard-1'),
      revision: 1,
      goalId: request.goalId,
      checks: request.checks.map(({ caseBodies: _bodies, ...check }) => check),
      relaxed: [],
      createdAt: 1,
      updatedAt: 1,
      directivesIssued: 0,
      runsRecorded: 0,
    }
    return this.view
  }

  extend(_agent: Agent, ref: StandardRef, checks: readonly AuthoredCheck[]): StandardView {
    this.extended.push({ ref, checks: [...checks] })
    const current = this.view as StandardView
    this.view = {
      ...current,
      revision: current.revision + 1,
      checks: [...current.checks, ...checks.map(({ caseBodies: _bodies, ...check }) => check)],
    }
    return this.view
  }

  get(): StandardView | undefined {
    return this.view
  }
}

/** The shell the instrument samples the reference through; each command answers from its script. */
class StubShell extends Service {
  static current: StubShell
  readonly commands: string[] = []
  readonly scripted = new Map<string, ShellRunResult[]>()
  /** Answers every unscripted command, so a test only scripts what it asserts on. */
  fallback: () => ShellRunResult = () => shellResult({ stdout: 'reference\n' })
  constructor(ctx: Context) {
    super(ctx, 'shell')
    StubShell.current = this
  }

  script(command: string, ...results: ShellRunResult[]): void {
    this.scripted.set(command, results)
  }

  resolve(request: ShellExecRequest): ShellExecSpec {
    return {
      command: request.command,
      workdir: request.workdir ?? '/unset',
      timeoutMs: request.timeoutMs ?? 30_000,
      stdoutMaxBytes: 4096,
      sandboxPolicy: undefined,
    }
  }

  async run(spec: ShellExecSpec): Promise<ShellRunResult> {
    this.commands.push(spec.command)
    return this.scripted.get(spec.command)?.shift() ?? this.fallback()
  }
}

type ShellResultInput = Partial<Omit<ShellRunResult, 'stdout' | 'stderr'>> & {
  stdout?: string
  stderr?: string
  stdoutTruncated?: boolean
}

function shellResult(partial: ShellResultInput = {}): ShellRunResult {
  const { stdout = '', stderr = '', stdoutTruncated = false, ...rest } = partial
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: 1000,
    ...rest,
    stdout: { text: stdout, truncated: stdoutTruncated },
    stderr: { text: stderr, truncated: false },
  }
}

interface Harness {
  readonly ctx: Context
  readonly agent: Agent
  readonly reservation: string
}

/** A composed instrument over a reservation that already holds a reference entry. */
async function harness(options: { reference?: boolean; config?: toolStandardAuthor.Config } = {}): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ToolRuntime)
  for (const stub of [StubReadBarrier, StubGoals, StubStandards, StubShell]) await ctx.plugin(stub)
  await ctx.plugin(toolStandardAuthor, options.config ?? {})
  const reservation = await mkdtemp(join(tmpdir(), 'standard-author-'))
  StubReadBarrier.current.reservation_ = reservation
  if (options.reference !== false) {
    mkdirSync(join(reservation, 'reference'), { recursive: true })
    writeFileSync(join(reservation, 'reference', 'run'), 'printf hello\n')
  }
  const agent = stubAgent(`validator-${Math.random()}`)
  ctx.agents.register(agent)
  return { ctx, agent, reservation }
}

/** Execute the instrument once for one agent. */
async function call(harnessed: Harness, args: unknown): Promise<ToolExecutionResult> {
  return await harnessed.ctx.agents.withInitiator(harnessed.agent, () => harnessed.ctx.tools.execute({
    signal,
    callId: CallId(`call-${Math.random()}`),
    name: 'standard_author',
    arguments: args,
    agent: harnessed.agent,
  }))
}

/** The one text block of a tool result. */
function text(result: ToolExecutionResult): string {
  const block = result.content[0]
  if (block?.type !== 'text') throw new Error('expected a text tool result')
  return block.text
}

/** One recorded case with the fields every test varies; a listed key is left out entirely. */
function record(rest: Record<string, unknown> = {}, omit: readonly string[] = []): Record<string, unknown> {
  const args = new Map<string, unknown>(Object.entries({
    action: 'record_case',
    checkId: 'tally',
    caseId: 'echo-word',
    weight: 3,
    argv: ['pepper'],
    channels: ['exit', 'stdout'],
    ...rest,
  }))
  for (const key of omit) args.delete(key)
  return Object.fromEntries(args)
}

describe('the instrument as a composed tool', () => {
  it('registers one authority-bearing tool and its guidance, and disposes both', async () => {
    const { ctx } = await harness()
    const definition = ctx.tools.get('standard_author')

    expect(definition?.authority).toEqual(STANDARD_AUTHOR_AUTHORITY)
    expect(definition?.authority).toEqual(['standard-author'])
    const section = (await ctx.systemPrompt.assemble()).sections.find(item => item.name === 'tool:standard-author')
    expect(section?.text).toContain('standard-sampling')
  })

  it('names the verb and the case in the pending card', async () => {
    const { ctx } = await harness()
    const definition = ctx.tools.get('standard_author')

    expect(definition?.presentCall?.({ action: 'record_case', caseId: 'echo-word' }))
      .toEqual({ card: 'generic', title: 'Sample the reference for case "echo-word"', kind: 'execute' })
    expect(definition?.presentCall?.({ action: 'weigh', caseId: 'echo-word' }))
      .toEqual({ card: 'generic', title: 'Weigh case "echo-word"', kind: 'other' })
    expect(definition?.presentCall?.({ action: 'freeze' }))
      .toEqual({ card: 'generic', title: 'Freeze the completion standard', kind: 'other' })
    // A logged call from a build whose case id was absent still renders.
    expect(definition?.presentCall?.({ action: 'record_case' }))
      .toEqual({ card: 'generic', title: 'Sample the reference for case', kind: 'execute' })
  })

  it('registers a companion that checks nothing of its own', async () => {
    const installers: InvariantInstaller[] = []
    const register = vi.fn((_package: string, install: InvariantInstaller) => {
      installers.push(install)
      return vi.fn()
    })
    const ctx = new Context()
    ctx.provide('invariants', { register })
    const dispose = await invariantCompanion.apply(ctx)

    expect(invariantCompanion.name).toBe('tool-standard-author-invariant')
    expect(invariantCompanion.inject).toEqual(['invariants'])
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-tool-standard-author', expect.any(Function))
    // The installer is the package's stated empty companion.
    const install = installers[0]
    if (install === undefined) throw new Error('the companion registered no installer')
    await install(ctx, (reason: string) => { throw new Error(reason) })
    dispose()
  })
})

describe('record_case', () => {
  it('samples the reference twice and keeps the digests both runs agreed on', async () => {
    const harnessed = await harness()
    const result = await call(harnessed, record())

    expect(result.isError).toBe(false)
    expect(text(result)).toBe(
      'Recorded case "echo-word" of check "tally" at weight 3, comparing exit, stdout. '
      + 'The reference produced the same result on both runs. Check "tally" now holds 1 case(s).',
    )
    const entry = join(harnessed.reservation, 'reference', 'run')
    expect(StubShell.current.commands).toEqual([`. ${entry} pepper`, `. ${entry} pepper`])
  })

  it('stages the case files and feeds its stdin from an emptied scratch workspace', async () => {
    const harnessed = await harness()
    await call(harnessed, record({
      files: [{ path: 'input/data.txt', content: 'rows\n' }],
      stdin: 'piped\n',
      normalizers: ['crlf'],
    }))

    const staged = join(harnessed.reservation, 'sampling', 'input', 'data.txt')
    expect(await readFile(staged, 'utf8')).toBe('rows\n')
  })

  it('digests the tree a case leaves under its scope', async () => {
    const harnessed = await harness()
    StubShell.current.fallback = () => shellResult()
    const result = await call(harnessed, record({ channels: ['tree'], treeScope: 'out' }))

    expect(result.isError).toBe(false)
    expect(text(result)).toContain('comparing tree')
  })

  it('refuses a case whose configured channel changes between the two runs', async () => {
    const harnessed = await harness()
    const entry = join(harnessed.reservation, 'reference', 'run')
    StubShell.current.script(
      `. ${entry} pepper`,
      shellResult({ stdout: 'first\n' }),
      shellResult({ stdout: 'second\n' }),
    )
    const result = await call(harnessed, record())

    expect(result.isError).toBe(true)
    expect(text(result)).toContain(
      'the reference did not produce the same stdout twice for case "echo-word"; '
      + 'a case whose expected result changes between runs cannot measure a candidate, so it was not recorded',
    )
  })

  it('refuses a case whose configured channel produced no usable expected result', async () => {
    const harnessed = await harness()
    StubShell.current.fallback = () => shellResult({ stdout: 'clipped', stdoutTruncated: true })
    const result = await call(harnessed, record())

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('the reference produced no usable stdout for case "echo-word"')
  })

  it('refuses a second case under the same id', async () => {
    const harnessed = await harness()
    await call(harnessed, record())
    const result = await call(harnessed, record({ weight: 9 }))

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('check "tally" already holds a case "echo-word"')
  })

  it.each([
    [{}, ['checkId'], '"checkId" is required for the "record_case" action'],
    [{}, ['caseId'], '"caseId" is required for the "record_case" action'],
    [{}, ['weight'], '"weight" is required for the "record_case" action'],
    [{}, ['channels'], '"channels" is required for the "record_case" action'],
    [{ checkId: 'Tally' }, [], 'checkId "Tally" must be lower-kebab-case'],
    [{ caseId: 'Echo' }, [], 'caseId "Echo" must be lower-kebab-case'],
    [{ weight: 0 }, [], 'weight of case "echo-word" must be a positive whole number'],
    [{ channels: [] }, [], 'case "echo-word" compares no channel'],
    [{ channels: ['exit', 'exit'] }, [], 'case "echo-word" repeats channel "exit"'],
    [{ channels: ['tree'] }, [], 'case "echo-word" compares the work tree without a treeScope to digest'],
    [{ treeScope: 'out' }, [], 'case "echo-word" declares a treeScope but compares no work tree'],
  ])('refuses %j without %j', async (patch, omit, reason) => {
    const harnessed = await harness()
    const result = await call(harnessed, record(patch, omit))

    expect(result.isError).toBe(true)
    expect(text(result)).toContain(reason)
  })

  it('leaves a channel and a normalizer outside the closed vocabulary to the schema', async () => {
    const harnessed = await harness()
    const unknown = await call(harnessed, record({ normalizers: ['smart-quotes'] }))

    expect(unknown.isError).toBe(true)
    expect(text(unknown)).toContain('"normalizers[0]" must be one of')
  })

  it('refuses a session that holds no reservation and one whose reservation stages no reference', async () => {
    const withoutReservation = await harness()
    StubReadBarrier.current.reservation_ = undefined
    const unreserved = await call(withoutReservation, record())

    expect(unreserved.isError).toBe(true)
    expect(text(unreserved)).toContain('this session holds no reserved directory')

    const withoutReference = await harness({ reference: false })
    const unstaged = await call(withoutReference, record())

    expect(unstaged.isError).toBe(true)
    expect(text(unstaged)).toContain('no reference program was staged for this session')
  })

  it('feeds no command words when the case names none', async () => {
    const harnessed = await harness()
    const result = await call(harnessed, record({}, ['argv']))

    expect(result.isError).toBe(false)
    expect(StubShell.current.commands[0]).toBe(`. ${join(harnessed.reservation, 'reference', 'run')}`)
  })

  it('applies the configured per-run timeout to every sampling run', async () => {
    const harnessed = await harness({ config: { referenceTimeoutMs: 250 } })
    await call(harnessed, record())

    expect(StubShell.current.commands).toHaveLength(2)
  })
})

describe('weigh', () => {
  it('restates a recorded case weight', async () => {
    const harnessed = await harness()
    await call(harnessed, record())
    const result = await call(harnessed, { action: 'weigh', checkId: 'tally', caseId: 'echo-word', weight: 7 })

    expect(result.isError).toBe(false)
    expect(text(result)).toBe('Case "echo-word" of check "tally" now carries weight 7.')
    expect(result.value).toMatchObject({ action: 'weigh', weight: 7 })
  })

  it('refuses a case nothing recorded, and a weight that is not a positive whole number', async () => {
    const harnessed = await harness()
    const missing = await call(harnessed, { action: 'weigh', checkId: 'tally', caseId: 'echo-word', weight: 2 })

    expect(missing.isError).toBe(true)
    expect(text(missing)).toContain('no case "echo-word" of check "tally" has been recorded')

    await call(harnessed, record())
    const negative = await call(harnessed, { action: 'weigh', checkId: 'tally', caseId: 'echo-word', weight: -1 })

    expect(negative.isError).toBe(true)
    expect(text(negative)).toContain('weight of case "echo-word" must be a positive whole number')
  })
})

describe('freeze', () => {
  it('writes the case bodies beside the reservation and authors the standard', async () => {
    const harnessed = await harness()
    await call(harnessed, record())
    await call(harnessed, record({ caseId: 'count-chars', weight: 2, argv: ['-c', 'pepper'] }))
    const result = await call(harnessed, {
      action: 'freeze',
      checks: [{ id: 'tally', outcome: 'the program echoes and counts' }],
    })

    expect(result.isError).toBe(false)
    expect(text(result)).toBe(
      'Froze 1 check(s) carrying 2 case(s) of total weight 5. '
      + 'The standard measuring this task is now revision 1; the implementer is measured by it and never sees it.',
    )
    const bodies = (await readFile(join(harnessed.reservation, 'checks', 'tally', 'cases.jsonl'), 'utf8'))
      .split('\n').filter(line => line !== '').map(line => JSON.parse(line) as { id: string; weight: number })
    expect(bodies.map(body => [body.id, body.weight])).toEqual([['echo-word', 3], ['count-chars', 2]])
    const authored = StubStandards.current.authored[0]?.[0]
    expect(authored).toMatchObject({ id: 'tally', run: DEFAULT_CHECK_RUN, cases: { count: 2, weightTotal: 5 } })
    expect(authored?.caseBodies).toHaveLength(2)
  })

  it('extends the standard already measuring the goal, and keeps the authored run instruction', async () => {
    const harnessed = await harness()
    await call(harnessed, record())
    await call(harnessed, { action: 'freeze', checks: [{ id: 'tally', outcome: 'first' }] })
    await call(harnessed, record({ checkId: 'errors', caseId: 'no-argument', weight: 1, argv: [] }))
    const result = await call(harnessed, {
      action: 'freeze',
      checks: [{ id: 'errors', outcome: 'second', run: 'sh ./tally.sh' }],
    })

    expect(result.isError).toBe(false)
    expect(text(result)).toContain('is now revision 2')
    expect(StubStandards.current.extended[0]?.ref).toEqual({ id: 'standard-1', revision: 1 })
    expect(StubStandards.current.extended[0]?.checks[0]).toMatchObject({ id: 'errors', run: 'sh ./tally.sh' })
  })

  it('carries the tree scope its cases were recorded against, and refuses a restated one that disagrees', async () => {
    const harnessed = await harness()
    StubShell.current.fallback = () => shellResult()
    await call(harnessed, record({ channels: ['tree'], treeScope: 'out' }))
    const disagreeing = await call(harnessed, {
      action: 'freeze',
      checks: [{ id: 'tally', outcome: 'writes out/', treeScope: 'build' }],
    })

    expect(disagreeing.isError).toBe(true)
    expect(text(disagreeing)).toContain('was recorded against treeScope "out", not "build"')

    const agreeing = await call(harnessed, {
      action: 'freeze',
      checks: [{ id: 'tally', outcome: 'writes out/', treeScope: 'out' }],
    })

    expect(agreeing.isError).toBe(false)
    expect(StubStandards.current.authored[0]?.[0]).toMatchObject({ treeScope: 'out' })
  })

  it('refuses a restated tree scope for a check whose cases recorded none', async () => {
    const harnessed = await harness()
    await call(harnessed, record())
    const result = await call(harnessed, {
      action: 'freeze',
      checks: [{ id: 'tally', outcome: 'echoes', treeScope: 'out' }],
    })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('check "tally" was recorded against treeScope null, not "out"')
  })

  it.each([
    [{}, '"checks" is required for the "freeze" action'],
    [{ checks: [] }, 'freeze needs at least one check'],
    [{ checks: [{ id: 'Tally', outcome: 'x' }] }, 'check id "Tally" must be lower-kebab-case'],
    [{ checks: [{ id: 'unsampled', outcome: 'x' }] }, 'check "unsampled" has no recorded cases'],
    [{ checks: [{ id: 'tally', outcome: '  ' }] }, 'check "tally" needs an outcome'],
  ])('refuses %j', async (patch, reason) => {
    const harnessed = await harness()
    await call(harnessed, record())
    const result = await call(harnessed, { action: 'freeze', ...patch })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain(reason)
  })

  it('refuses a session with no goal for the standard to measure', async () => {
    const harnessed = await harness()
    await call(harnessed, record())
    StubGoals.current.goal = undefined
    const result = await call(harnessed, { action: 'freeze', checks: [{ id: 'tally', outcome: 'x' }] })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('this session has no goal for a standard to measure')
  })

  it('clears the frozen check, so freezing it again refuses instead of duplicating it', async () => {
    const harnessed = await harness()
    await call(harnessed, record())
    await call(harnessed, { action: 'freeze', checks: [{ id: 'tally', outcome: 'x' }] })
    const again = await call(harnessed, { action: 'freeze', checks: [{ id: 'tally', outcome: 'x' }] })

    expect(again.isError).toBe(true)
    expect(text(again)).toContain('check "tally" has no recorded cases')
  })
})

describe('an agentless call', () => {
  it('is refused, because the instrument authors one session\'s own standard', async () => {
    const harnessed = await harness()
    const result = await harnessed.ctx.tools.execute({
      signal,
      callId: CallId('agentless'),
      name: 'standard_author',
      arguments: { action: 'weigh', checkId: 'tally', caseId: 'echo-word', weight: 1 },
    })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('this call has no session')
  })
})

describe('the reference entry the instrument sources', () => {
  it('is the run file of the reservation\'s reference directory', async () => {
    const harnessed = await harness()
    await writeFile(join(harnessed.reservation, 'reference', 'run'), 'printf other\n')
    await call(harnessed, record())

    expect(StubShell.current.commands[0]).toBe(`. ${join(harnessed.reservation, 'reference', 'run')} pepper`)
  })
})
