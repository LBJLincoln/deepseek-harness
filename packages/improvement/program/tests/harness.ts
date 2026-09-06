/**
 * Shared unit harness for the program service: the real session store, agent
 * registry, goal domain, verification domain, and JSONL persistence backend
 * over a temporary root, with a scripted shell, a stubbed preset roster, a
 * stubbed default-model selection, an optional stubbed subagent seam, and an
 * agent factory whose turns are whatever the test says they are.
 */

import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentFactory } from '@deepseek-ai/dsh-agent'
import type { AgentPreset } from '@deepseek-ai/dsh-agent-presets'
import GoalService from '@deepseek-ai/dsh-goal'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { ShellExecRequest, ShellExecSpec, ShellRunResult } from '@deepseek-ai/dsh-shell'
import SignoffService from '@deepseek-ai/dsh-signoff'
import type { SignoffTransition } from '@deepseek-ai/dsh-signoff'
import type {
  SubagentCapabilities,
  SubagentResult,
  SubagentRun,
  SubagentStartRequest,
} from '@deepseek-ai/dsh-subagent'
import CompletionStandardService from '@deepseek-ai/dsh-verification'
import ProgramService, { programIdFor, programSpecDigest, resolveProgramSpec, type Config } from '@deepseek-ai/dsh-program'
import type { ProgramSpec } from '@deepseek-ai/dsh-program'

/** One scripted command outcome; every field the service reads is stated. */
export interface ScriptedRun {
  /** Exit code; `null` states a command a signal killed. */
  exitCode?: number | null
  stdout?: string
  stderr?: string
  signal?: NodeJS.Signals
  timedOut?: boolean
  aborted?: boolean
}

/** The command lines one program pass ran, in order. */
type CommandLog = string[]

/** What a scripted shell answers for one command line. */
type ShellScript = (command: string, workdir: string) => ScriptedRun | Promise<ScriptedRun>

/** Build one complete run result from a scripted outcome. */
function runResult(scripted: ScriptedRun): ShellRunResult {
  return {
    exitCode: scripted.exitCode === undefined ? 0 : scripted.exitCode,
    signal: scripted.signal ?? null,
    timedOut: scripted.timedOut ?? false,
    aborted: scripted.aborted ?? false,
    timeoutMs: 1_000,
    stdout: { text: scripted.stdout ?? '', truncated: false },
    stderr: { text: scripted.stderr ?? '', truncated: false },
  }
}

/**
 * Build a registry-compatible agent around one concrete session.
 * @param session - the session the agent runs on.
 * @param onFollowup - what the agent's one turn does, called with the agent itself.
 * @returns the stub agent.
 */
export function stubAgent(session: Session, onFollowup: (agent: Agent) => void = () => {}): Agent {
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    status: 'idle',
    send: () => {},
    followup: () => { onFollowup(agent) },
    steer: () => {},
    inject(input) { inbox.append('next-step', input) },
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  return agent
}

/** Start-time capabilities of an in-process backend, which composes its child here and honors every one. */
export const IN_PROCESS_CAPABILITIES: SubagentCapabilities = {
  outputSchema: true,
  depthLimit: true,
  toolFilter: true,
  persona: true,
}

/** Start-time capabilities of an out-of-process backend, which can honor none of them. */
export const OUT_OF_PROCESS_CAPABILITIES: SubagentCapabilities = {
  outputSchema: false,
  depthLimit: false,
  toolFilter: false,
  persona: false,
}

/** One delegated child the stubbed seam serves. */
export interface StubbedProvider {
  /** Registry name the program addresses the provider by. */
  readonly name: string
  /** What the provider advertises, which is what the program's isolation rule reads. */
  readonly capabilities: SubagentCapabilities
  /**
   * What one child run does to its parent's worktree and what it comes to. The
   * default completes without touching anything.
   */
  readonly run?: (request: SubagentStartRequest, attempt: number) => SubagentResult | Promise<SubagentResult>
  /**
   * Input plus output tokens a locally published child's own session accounts
   * for. Omitting it publishes no local child, which is what a run in another
   * process returns and what leaves the program's record without usage.
   */
  readonly localTokens?: number
}

/** One delegated start the stubbed seam observed, reached through {@link ProgramHarness.starts}. */
interface StubbedStart {
  readonly provider: string
  /** The prompt text the program delegated. */
  readonly prompt: string
  /** The delegating parent session's own workspace, which is what a provider derives the child cwd from. */
  readonly parentCwd: string | undefined
  readonly label: string | undefined
  /** The cancellation the program handed the child. */
  readonly signal: AbortSignal
  /** Whether the run was disposed. */
  disposed: boolean
}

/**
 * One published local child whose own session accounts for the tokens its run
 * spent, which is what the program folds a delegation's usage from.
 * @param ctx - the harness context holding the session store.
 * @param id - the child session's id.
 * @param totalTokens - input plus output tokens the child's log accounts for.
 * @returns the child agent the stubbed run publishes.
 */
function spentChild(ctx: Context, id: string, totalTokens: number): Agent {
  const session = ctx.sessions.create(id as SessionId)
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: {
      id: `${id}-message`,
      role: 'assistant',
      content: [{ type: 'text', text: 'delivered' }],
      source: { kind: 'assistant', provider: 'cli-mock', model: 'cli-mock' },
    },
    usage: { inputTokens: totalTokens, outputTokens: 0 },
  } as never, { surfaceOp: 'append' })
  return stubAgent(session)
}

/** One signature a case records on a program session before the program starts. */
interface HarnessSignature {
  readonly transition: SignoffTransition
  readonly artefactSha256: string
}

/** The presets a harness roster supplies, keyed by id. */
type PresetRoster = readonly AgentPreset[]

/** Everything a program unit test drives the service through. */
export interface ProgramHarness {
  readonly ctx: Context
  readonly programs: ProgramService
  /** The git repository root every worktree is minted under. */
  readonly root: string
  /** The persistence root the ledger and every department log live in. */
  readonly sessions: string
  /** Every command line the scripted shell served, in order. */
  readonly commands: CommandLog
  /** Every delegated start the stubbed seam served, in order. */
  readonly starts: StubbedStart[]
  /** What each agent's turn appends to its own session before the checks run. */
  turn: (agent: Agent) => void
  /**
   * Record signatures on the program session one spec addresses, the way a
   * caller signs a spec freeze and a release before calling `start`. The
   * session is left persisted and out of the live store, exactly as the
   * service's own scan expects to find it.
   */
  sign: (spec: ProgramSpec, signatures: readonly HarnessSignature[]) => Promise<void>
  /** Unload the program service alone, the way a stopping process does. */
  unload: () => Promise<void>
  dispose: () => Promise<void>
}

/** The roster entry a preset id resolves to unless a test says otherwise. */
export function implementerPreset(id: string): AgentPreset {
  return { id, trust: 'system', path: `/presets/${id}/agent.cordis.yml`, role: 'implementer' }
}

/** Options a harness accepts beyond the service config. */
export interface HarnessOptions {
  /** The roster `ctx.agentPresets.list()` answers with. */
  presets?: PresetRoster
  /** What the scripted shell answers; the default passes every command. */
  script?: ShellScript
  /** An existing persistence root, so two harnesses can share one. */
  sessions?: string
  /** An existing repository root, so two harnesses can share one. */
  root?: string
  /**
   * A Loader whose settlement the service's own reconciliation waits for. A
   * promise that never settles keeps that reconciliation out of a case that
   * drives the program through its own call instead.
   */
  loader?: { await: () => Promise<void> }
  /**
   * The providers a stubbed `ctx.subagents` registers. Omitting the option
   * composes no seam at all, which is what a delegating program is refused for.
   */
  subagents?: readonly StubbedProvider[]
}

/**
 * Mount one program service over the real session, goal, verification, and
 * persistence plugins with the outside world scripted.
 * @param config - the service config minus the roots the harness owns.
 * @param options - roster, shell script, and roots to share with another harness.
 * @returns the mounted harness.
 */
export async function programHarness(
  config: Partial<Config> = {},
  options: HarnessOptions = {},
): Promise<ProgramHarness> {
  const root = options.root ?? mkdtempSync(join(tmpdir(), 'program-root-'))
  const sessions = options.sessions ?? mkdtempSync(join(tmpdir(), 'program-sessions-'))
  const commands: CommandLog = []
  const starts: StubbedStart[] = []
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(GoalService)
  await ctx.plugin(CompletionStandardService)
  await ctx.plugin(JsonlSessionPersistence, { root: sessions, compression: 'none' })
  await ctx.plugin(SignoffService, { maxEvidence: 8, maxEvidenceRefChars: 256 })

  const harness: ProgramHarness = {
    ctx,
    programs: undefined as unknown as ProgramService,
    root,
    sessions,
    commands,
    starts,
    turn: () => {},
    sign: () => Promise.resolve(),
    unload: () => Promise.resolve(),
    dispose: async () => { await ctx.fiber.dispose() },
  }
  if (options.loader !== undefined) ctx.provide('loader', options.loader as never)
  if (options.subagents !== undefined) {
    const providers = new Map(options.subagents.map(provider => [provider.name, provider]))
    const attempts = new Map<string, number>()
    ctx.provide('subagents', {
      getProvider: (name: string) => {
        const provider = providers.get(name)
        return provider === undefined ? undefined : { name, capabilities: provider.capabilities }
      },
      start: async (name: string, request: SubagentStartRequest): Promise<SubagentRun> => {
        const provider = providers.get(name) as StubbedProvider
        const attempt = (attempts.get(name) ?? 0) + 1
        attempts.set(name, attempt)
        const observed: StubbedStart = {
          provider: name,
          prompt: request.prompt.map(block => (block.type === 'text' ? block.text : '')).join(''),
          parentCwd: request.parent.session.header.cwd,
          label: request.label,
          signal: request.signal,
          disposed: false,
        }
        starts.push(observed)
        const result = await (provider.run ?? ((): SubagentResult => ({ output: [], stopReason: 'completed' })))(request, attempt)
        // A local run publishes a child agent whose own session accounts for
        // the tokens; a remote one has none, so the program records no usage.
        const localAgent = provider.localTokens === undefined
          ? undefined
          : spentChild(ctx, `child-${name}-${String(attempt)}`, provider.localTokens)
        return {
          id: (localAgent?.id ?? `run-${name}-${String(attempt)}`) as SessionId,
          localAgent,
          result: Promise.resolve(result),
          dispose: () => { observed.disposed = true; return Promise.resolve() },
        }
      },
    } as never)
  }

  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'cli-mock', model: 'cli-mock' }),
  } as never)
  ctx.provide('agentPresets', {
    list: () => Promise.resolve([...options.presets ?? [implementerPreset('implementing')]]),
    mount: () => Promise.resolve(implementerPreset('implementing')),
  } as never)
  ctx.provide('shell', {
    resolve: (request: ShellExecRequest) => request as ShellExecSpec,
    run: async (spec: ShellExecSpec) => {
      commands.push(spec.command)
      const scripted = await (options.script ?? ((): ScriptedRun => ({})))(spec.command, spec.workdir ?? root)
      // The service reuses a worktree directory that is already there, so the
      // scripted `worktree add` has to leave one behind.
      if (spec.command.includes('worktree add') && (scripted.exitCode ?? 0) === 0) {
        mkdirSync(spec.command.split(' ').at(-2) as string, { recursive: true })
      }
      return runResult(scripted)
    },
  } as never)

  const factory: AgentFactory = {
    async createAgent(_ownerCtx, created) {
      const session = ctx.sessions.create(created.sessionId, created.meta === undefined ? {} : { meta: created.meta })
      const agent = stubAgent(session, (current) => { harness.turn(current) })
      const agentCtx = ctx.extend({ agent })
      ;(agent as { ctx?: Context }).ctx = agentCtx
      await created.setup?.(agentCtx)
      const unregister = ctx.agents.register(agent)
      return { agent, dispose: () => { unregister(); return Promise.resolve() } }
    },
    async resume(_ownerCtx, resumed) {
      const preparation = await ctx.sessionPersistence.prepare(resumed.resumeSessionId)
      const agent = stubAgent(preparation.session, (current) => { harness.turn(current) })
      const agentCtx = ctx.extend({ agent })
      ;(agent as { ctx?: Context }).ctx = agentCtx
      await resumed.setup?.(agentCtx)
      const leave = ctx.sessions.enter(preparation.session)
      ctx.sessions.announce(preparation.session)
      const unregister = ctx.agents.register(agent)
      return {
        agent,
        dispose: () => {
          unregister()
          leave()
          preparation[Symbol.dispose]()
          return Promise.resolve()
        },
      }
    },
  }
  ctx.agents.setFactory(factory)

  const fiber = await ctx.plugin(ProgramService, {
    workspaceRoot: root,
    requireSignoff: false,
    maxConcurrentGoals: 2,
    maxGoalRounds: 2,
    branchPrefix: 'program',
    evidenceMaxChars: 512,
    ...config,
  })
  ;(harness as { programs: ProgramService }).programs = ctx.programs
  ;(harness as { unload: () => Promise<void> }).unload = async () => { await fiber.dispose() }
  ;(harness as { sign: ProgramHarness['sign'] }).sign = async (spec, signatures) => {
    const session = ctx.sessions.prepare(SessionId(programIdFor(programSpecDigest(resolveProgramSpec(spec)))))
    const leave = ctx.sessions.enter(session)
    try {
      ctx.sessions.announce(session)
      for (const signature of signatures) {
        ctx.signoffs.record(stubAgent(session), {
          transition: signature.transition,
          principal: { kind: 'human', id: 'release-manager', displayName: 'Release Manager' },
          artefactSha256: signature.artefactSha256,
          evidence: [{ kind: 'spec', ref: 'the frozen spec' }],
        })
      }
      await ctx.sessions.flush(session)
    } finally {
      leave()
    }
  }
  return harness
}
