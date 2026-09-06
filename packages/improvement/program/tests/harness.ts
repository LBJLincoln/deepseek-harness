/**
 * Shared unit harness for the program service: the real session store, agent
 * registry, goal domain, verification domain, and JSONL persistence backend
 * over a temporary root, with a scripted shell, a stubbed preset roster, a
 * stubbed default-model selection, and an agent factory whose turns are
 * whatever the test says they are.
 */

import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentFactory } from '@deepseek-ai/dsh-agent'
import type { AgentPreset } from '@deepseek-ai/dsh-agent-presets'
import GoalService from '@deepseek-ai/dsh-goal'
import SessionStore, { Session } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { ShellExecRequest, ShellExecSpec, ShellRunResult } from '@deepseek-ai/dsh-shell'
import CompletionStandardService from '@deepseek-ai/dsh-verification'
import ProgramService, { type Config } from '@deepseek-ai/dsh-program'

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
  /** What each agent's turn appends to its own session before the checks run. */
  turn: (agent: Agent) => void
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
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(GoalService)
  await ctx.plugin(CompletionStandardService)
  await ctx.plugin(JsonlSessionPersistence, { root: sessions, compression: 'none' })

  const harness: ProgramHarness = {
    ctx,
    programs: undefined as unknown as ProgramService,
    root,
    sessions,
    commands,
    turn: () => {},
    unload: () => Promise.resolve(),
    dispose: async () => { await ctx.fiber.dispose() },
  }
  if (options.loader !== undefined) ctx.provide('loader', options.loader as never)

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
  return harness
}
