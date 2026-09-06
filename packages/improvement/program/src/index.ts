/**
 * Programs: the durable ledger of one client deliverable decomposed into many
 * goals. A program is a frozen spec, one program session holding `program/*`
 * events, one department session and git worktree per goal, and one integration
 * session whose certificate over the merged head is what a release claims.
 * Every ledger event is appended after the fact it records is durable, so a
 * restarted process reconciles each goal from its department's own log and
 * worktree and never runs a department twice. A department is staffed either by
 * the harness agent this service drives or, through the subagent seam, by an
 * external coding agent whose attempts this service records and whose tree it
 * certifies. The
 * [program-ledger](../../../.agents/notes/proposed/architecture/2026-09-06-program-ledger.md)
 * and
 * [external-implementer](../../../.agents/notes/proposed/architecture/2026-09-06-program-external-implementer.md)
 * Agent Notes own the design rationale.
 * @module @deepseek-ai/dsh-program
 */

import { stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
// Type-only: resolves the Loader the service waits for before its first reconciliation.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, AgentOptions, AgentSetup } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
// Type-only: resolves ctx.agentPresets.
import type {} from '@deepseek-ai/dsh-agent-presets'
import { foldBudgetSpend } from '@deepseek-ai/dsh-budget-policy'
import type {} from '@deepseek-ai/dsh-goal'
import { assertNever, createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-read-barrier'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { latestSignoff } from '@deepseek-ai/dsh-signoff'
import type { SignoffTransition } from '@deepseek-ai/dsh-signoff'
// Type-only: resolves ctx.sessionPersistence.
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { ShellRunResult } from '@deepseek-ai/dsh-shell'
// Also resolves the optional ctx.subagents a delegated department reads.
import type { SubagentProvider, SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-verification'
import type { CertificateIsolation, CheckResult, StandardCheck } from '@deepseek-ai/dsh-verification/types'
import {
  countStatuses,
  foldDepartmentLog,
  foldProgramLedger,
  memberSpend,
  programSpend,
} from './ledger.ts'
import type { ProgramLedger, ProgramMemberSpend, ScannedSession } from './ledger.ts'
import {
  dependencyOrder,
  INTEGRATION_KEY,
  integrationChecks,
  ProgramError,
  programIdFor,
  programSpecDigest,
  resolveProgramSpec,
} from './spec.ts'
import { PROGRAM_BRANCH_PREFIX } from './spec.ts'
import type {
  FrozenProgramSpec,
  ProgramDelegationUsage,
  ProgramEnd,
  ProgramGoalSpec,
  ProgramGoalStatus,
  ProgramId,
  ProgramImplementer,
  ProgramIntegrationRecord,
  ProgramOutcome,
  ProgramSpec,
} from './types.ts'

export type * from './types.ts'
export {
  countStatuses,
  foldDepartmentLog,
  foldProgramLedger,
  memberSpend,
  programSpend,
} from './ledger.ts'
export type { DepartmentLog, ProgramLedger, ProgramMemberSpend, ScannedSession } from './ledger.ts'
export {
  dependencyOrder,
  INTEGRATION_KEY,
  integrationChecks,
  PROGRAM_BRANCH_PREFIX,
  PROGRAM_GOAL_KEY,
  PROGRAM_ID_PREFIX,
  ProgramError,
  ProgramId,
  programIdFor,
  ProgramSpecSchema,
  programSpecDigest,
  resolveProgramSpec,
} from './spec.ts'
export type { ProgramErrorCode } from './spec.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    programs: ProgramService
  }
}

/**
 * Characters a path handed to the composed shell may contain. Git commands are
 * assembled as command lines, so every path they carry must need no shell
 * quoting: quoting is dialect-specific and this service does not know the
 * composed shell's dialect.
 */
const UNQUOTED_COMMAND_WORD = /^[A-Za-z0-9_@%+=:,./\\-]+$/

/** Revisions a spec may name; `@` is excluded so no revision can carry `@{`. */
const PROGRAM_REVISION = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

/** Deployment choices of the program service, validated from `cordis.yml`. */
export interface Config {
  /** The git repository the program delivers into; every worktree is minted under it. */
  workspaceRoot: string
  /** Whether a program without a signoff record may start departments or release. */
  requireSignoff: boolean
  /** Departments of one program that may run at the same time. */
  maxConcurrentGoals: number
  /** Round cap of every department and integration goal, and the attempts this service drives. */
  maxGoalRounds: number
  /** Branch namespace of every worktree: `<branchPrefix>/<programId>/<key>`. */
  branchPrefix: string
  /** Bound of each recorded check evidence; keep it at or below the verification domain's text cap. */
  evidenceMaxChars: number
}

/** What one goal of a program came to, as the ledger records it. */
export interface ProgramGoalOutcome {
  readonly key: string
  readonly status: ProgramGoalStatus
  /** The department's session, absent while it has none. */
  readonly sessionId?: SessionId
  /** The department branch head at the latest recorded status. */
  readonly revision?: string
  /** The blocking code or failure text of the latest recorded status. */
  readonly reason?: string
}

/** What one pass over a program produced, read back from the ledger it wrote. */
export interface ProgramReport {
  readonly programId: ProgramId
  /** The program session, whose id is the program id. */
  readonly sessionId: SessionId
  /** How the program ended, absent while it is unfinished. */
  readonly outcome?: ProgramOutcome
  /** The certified merged head, present once the integration certified one. */
  readonly mergedRevision?: string
  /** Every goal of the spec, in spec order. */
  readonly goals: readonly ProgramGoalOutcome[]
}

/** One department's live state inside one pass. */
interface DepartmentState {
  readonly goal: ProgramGoalSpec
  status: ProgramGoalStatus
  sessionId: SessionId | undefined
  workspace: string | undefined
  revision: string | undefined
  reason: string | undefined
  /** Whether a department pass currently owns this state. */
  driving: boolean
}

/** One program being driven by one pass. */
interface ProgramRun {
  readonly programId: ProgramId
  readonly spec: FrozenProgramSpec
  /** The program session, entered and announced for the length of the pass. */
  readonly session: Session
  readonly states: Map<string, DepartmentState>
  integration: ProgramIntegrationRecord | undefined
  outcome: ProgramOutcome | undefined
}

/**
 * One department's resolved staffing, captured before its first attempt: the
 * seam the children start on, the provider name, and the label they carry.
 */
interface ResolvedImplementer {
  /** The seam this department's attempts run on. */
  readonly subagents: SubagentRuntime
  /** Name the provider is registered under on {@link ResolvedImplementer.subagents}. */
  readonly provider: string
  /** The label passed to every child of this department. */
  readonly label?: string
}

/**
 * What one attempt does on the branch before the checks run: the model turn
 * this service drives, or one delegated child run.
 * @param prompt - the text this attempt starts from.
 * @param attempt - the 1-based attempt, counted across every process that drove
 *   this session.
 * @returns whether the session may still be certified; `false` stops the attempts.
 */
type AttemptWork = (prompt: string, attempt: number) => Promise<boolean>

/** One certification pass over one session's standard. */
interface AttemptPlan {
  /** The session being certified. */
  readonly agent: Agent
  /** The worktree the checks execute in. */
  readonly workspace: string
  /** The isolation level the certified run claims. */
  readonly isolation: CertificateIsolation
  /** The first attempt's text, or `undefined` to measure before any work. */
  readonly objective: string | undefined
  /** The attempt this pass starts at; a resumed department continues after what its log records. */
  readonly from: number
  /** What one attempt does before the checks run. */
  readonly work: AttemptWork
}

/** Whether one executed check passed: a zero exit that neither timed out nor was aborted. */
function passed(result: ShellRunResult): boolean {
  return result.exitCode === 0 && !result.timedOut && !result.aborted
}

/** Keep the tail of longer text inside the bound, marking what was dropped. */
function bounded(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `…${text.slice(text.length - maxChars + 1)}`
}

/** Render one executed command's outcome: the exit fact, then whatever it wrote. */
function outcomeOf(result: ShellRunResult): string {
  const exit = result.exitCode === null
    ? `terminated by ${result.signal ?? 'an unknown signal'}`
    : `exit ${String(result.exitCode)}`
  const written = [result.stdout.text, result.stderr.text]
    .map(stream => stream.trim())
    .filter(stream => stream !== '')
    .join('\n')
  return written === '' ? exit : `${exit}\n${written}`
}

/** The one user turn a department receives when its checks did not pass. */
function retryText(failures: readonly CheckResult[]): string {
  const listed = failures.map(failure => `- ${failure.checkId}: ${failure.evidence}`).join('\n')
  return `<checks_failed>\n${String(failures.length)} of this goal's checks did not pass on the branch as it stands.\n${listed}\nKeep working and commit; the checks run again when you stop.\n</checks_failed>`
}

/**
 * Whether one provider runs its child outside this process. An out-of-process
 * backend advertises no start-time capability at all, because a child in
 * another process can honor none of them; an in-process backend composes the
 * child here and honors them.
 */
function outOfProcess(provider: SubagentProvider): boolean {
  const { outputSchema, depthLimit, toolFilter, persona } = provider.capabilities
  return !outputSchema && !depthLimit && !toolFilter && !persona
}

/** Directory test that treats a missing or unreadable path as no directory. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    // stat rejects for a missing or unreadable path; both mean there is no
    // worktree there to reuse.
    return false
  }
}

/** Programs (`ctx.programs`): a durable, resumable ledger over one deliverable's goals. */
export class ProgramService extends Service {
  static inject = [
    'agents',
    'agentDefaultModel',
    'agentPresets',
    'completionStandards',
    'goals',
    'sessions',
    'sessionPersistence',
    'shell',
  ]

  static Config: z<Config> = z.object({
    workspaceRoot: z.string().required(),
    requireSignoff: z.boolean().required(),
    maxConcurrentGoals: z.natural().min(1).required(),
    maxGoalRounds: z.natural().min(1).required(),
    branchPrefix: z.string().required(),
    evidenceMaxChars: z.natural().min(1).required(),
  })

  private readonly config: Config
  /** Serializes every pass, so two entry points never drive one program twice. */
  private queue: Promise<unknown> = Promise.resolve()
  private stopping = false
  /**
   * Cancellation of every delegated child, aborted before the fiber waits for
   * the pass in flight. A child in another process observes nothing else this
   * service does, so without it a stopping process would wait on an external
   * agent that was never told to stop.
   */
  private readonly teardown = new AbortController()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'programs')
    this.config = config
    if (!isAbsolute(config.workspaceRoot) || !UNQUOTED_COMMAND_WORD.test(config.workspaceRoot)) {
      throw new ProgramError(
        `workspaceRoot "${config.workspaceRoot}" must be an absolute path the composed shell can carry unquoted`,
        'PROGRAM_INVALID_CONFIG',
      )
    }
    if (!PROGRAM_BRANCH_PREFIX.test(config.branchPrefix)) {
      throw new ProgramError(`branchPrefix "${config.branchPrefix}" must be lower-kebab-case git ref components`, 'PROGRAM_INVALID_CONFIG')
    }
    ctx.effect(() => () => this.settle(), 'programs.driver()')
    void this.boot()
  }

  /**
   * Start one program, or resume the program its spec already identifies.
   *
   * The spec is frozen into a digest before anything runs, so starting the same
   * spec twice addresses one program: the second call reconciles the existing
   * ledger instead of forking a second one.
   * @param spec - the deliverable to run.
   * @returns the ledger this pass left behind.
   * @throws {@link ProgramError} when the spec, its presets, or the spec-freeze
   *   signature the program session must carry cannot support a program.
   */
  async start(spec: ProgramSpec): Promise<ProgramReport> {
    const frozen: FrozenProgramSpec = resolveProgramSpec(spec)
    if (!PROGRAM_REVISION.test(frozen.baseRevision)) {
      throw new ProgramError(`baseRevision "${frozen.baseRevision}" is not a revision the composed shell can carry unquoted`, 'PROGRAM_INVALID_SPEC')
    }
    await this.requirePresets(frozen)
    const programId = programIdFor(programSpecDigest(frozen))
    return await this.enqueue(() => this.open(programId, frozen))
  }

  /**
   * Reconcile every unfinished program in the persistence root and carry it on.
   *
   * Each program's goals are read from their own department sessions and
   * worktrees rather than from the ledger, so a process that died between a
   * durable fact and its ledger record records the fact rather than repeating
   * the work.
   * @returns one report per program this pass reconciled, in scan order.
   */
  async resume(): Promise<ProgramReport[]> {
    return await this.enqueue(() => this.reconcileAll())
  }

  /** Run the first reconciliation over a settled application; a failure leaves the process running and logged. */
  private async boot(): Promise<void> {
    try {
      // A program mounts presets and reads persisted sessions, which sibling
      // Loader entries supply; a hand-built tree has no Loader and is settled already.
      await this.ctx.get('loader')?.await()
      await this.resume()
    } catch (error: unknown) {
      this.ctx.logger.error(`the program service did not reconcile at start: ${String(error)}`)
    }
  }

  /**
   * Refuse new work and wait for the pass in flight to settle. The queue is the
   * caught form of every pass, so a pass that rejected still settles it.
   */
  private async settle(): Promise<void> {
    this.stopping = true
    this.teardown.abort()
    await this.queue
  }

  /**
   * Chain one pass onto the single work queue. The queue itself is always the
   * caught form, so a pass that rejects delays the next one instead of
   * poisoning the chain.
   */
  private async enqueue<T>(pass: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() => pass())
    this.queue = next.catch(() => {
      // Retained only so the next pass starts after this one; the rejection is
      // delivered to the caller through `next`.
    })
    return await next
  }

  /** Reject a spec naming a preset the roster does not supply or does not compose as an implementer. */
  private async requirePresets(spec: FrozenProgramSpec): Promise<void> {
    const presets = await this.ctx.agentPresets.list()
    for (const goal of spec.goals) {
      const preset = presets.find(candidate => candidate.id === goal.preset)
      if (preset === undefined) {
        throw new ProgramError(`goal "${goal.key}" names preset "${goal.preset}", which no configured root supplies`, 'PROGRAM_UNKNOWN_PRESET')
      }
      if (preset.role !== 'implementer') {
        throw new ProgramError(
          `goal "${goal.key}" names preset "${goal.preset}", which declares role "${preset.role ?? 'unrestricted'}" rather than implementer`,
          'PROGRAM_UNKNOWN_PRESET',
        )
      }
    }
  }

  /** Read every persisted session once: the program ledgers and the member stamps. */
  private async scan(): Promise<{ ledgers: ProgramLedger[]; members: ProgramMemberSpend[]; sessions: Map<SessionId, ScannedSession> }> {
    const ledgers: ProgramLedger[] = []
    const members: ProgramMemberSpend[] = []
    const sessions = new Map<SessionId, ScannedSession>()
    for (const header of await this.ctx.sessionPersistence.list()) {
      const inspection = await this.ctx.sessionPersistence.inspect(header.id)
      const scanned: ScannedSession = { meta: inspection.meta, events: inspection.events }
      sessions.set(header.id, scanned)
      const ledger = foldProgramLedger(scanned)
      if (ledger !== undefined) ledgers.push(ledger)
      const member = memberSpend(scanned, foldBudgetSpend(inspection.events, {}).totalTokens)
      if (member !== undefined) members.push(member)
    }
    return { ledgers, members, sessions }
  }

  /** Reconcile and carry on every program whose ledger has no closing record. */
  private async reconcileAll(): Promise<ProgramReport[]> {
    const scan = await this.scan()
    const reports: ProgramReport[] = []
    for (const ledger of scan.ledgers) {
      if (this.stopping) break
      if (ledger.end !== undefined) continue
      reports.push(await this.pickUp(ledger, scan.sessions))
    }
    return reports
  }

  /** Start a program that has no ledger yet, or reconcile the one it already has. */
  private async open(programId: ProgramId, spec: FrozenProgramSpec): Promise<ProgramReport> {
    const scan = await this.scan()
    const existing = scan.ledgers.find(ledger => ledger.start.programId === programId)
    if (existing !== undefined) {
      if (existing.end !== undefined) return this.finishedReport(existing)
      return await this.pickUp(existing, scan.sessions)
    }
    const sessionId = SessionId(programId)
    const carried = scan.sessions.get(sessionId)
    this.requireSignoffRecord(spec, carried?.events ?? [], 'spec-freeze', 'start')
    if (carried === undefined) {
      const session = this.ctx.sessions.prepare(sessionId, { meta: { cwd: this.config.workspaceRoot } })
      return await this.publish(session, () => this.begin(session, programId, spec))
    }
    // The program id is derived from the spec digest, so a caller signing the
    // spec freeze addresses this session before the program exists. Its log is
    // continued rather than replaced, or the signature it holds would be lost.
    const preparation = await this.ctx.sessionPersistence.prepare(sessionId)
    try {
      return await this.publish(preparation.session, () => this.begin(preparation.session, programId, spec))
    } finally {
      preparation[Symbol.dispose]()
    }
  }

  /** Declare the program and every goal of its spec, then run it. */
  private async begin(session: Session, programId: ProgramId, spec: FrozenProgramSpec): Promise<ProgramReport> {
    session.append('program/start', {
      programId,
      specSha256: programSpecDigest(spec),
      spec,
      baseRevision: spec.baseRevision,
      implementer: spec.implementer,
      ...spec.signoff === undefined ? {} : { signoff: spec.signoff },
    })
    const run = this.newRun(programId, spec, session)
    for (const state of run.states.values()) this.record(run, state)
    await this.ctx.sessions.flush(session)
    return await this.drive(run)
  }

  /**
   * Reject a transition this deployment gates on a signature the program
   * session does not carry, or carries over another artefact than the spec
   * names. The signature is a `signoff/recorded` a caller appended through
   * `ctx.signoffs`; this service reads it and never writes one.
   * @param spec - the frozen spec, whose `signoff` names the attested artefact.
   * @param events - the program session's events, oldest first.
   * @param transition - the signature the transition needs.
   * @param transitioning - the refused transition, for the message.
   */
  private requireSignoffRecord(
    spec: FrozenProgramSpec,
    events: readonly SessionEvent[],
    transition: SignoffTransition,
    transitioning: string,
  ): void {
    if (!this.config.requireSignoff) return
    const artefact = spec.signoff?.artefactSha256
    if (artefact === undefined) {
      throw new ProgramError(
        `this deployment requires a signoff record before a program may ${transitioning}, and the spec names no artefact for one to attest`,
        'PROGRAM_SIGNOFF_REQUIRED',
      )
    }
    const record = latestSignoff(events, transition)
    if (record === undefined) {
      throw new ProgramError(
        `this deployment requires a "${transition}" signoff/recorded on the program session before a program may ${transitioning}`,
        'PROGRAM_SIGNOFF_REQUIRED',
      )
    }
    if (record.artefactSha256 !== artefact) {
      throw new ProgramError(
        `the "${transition}" signoff/recorded attests artefact ${record.artefactSha256}, which is not the spec's ${artefact}`,
        'PROGRAM_SIGNOFF_REQUIRED',
      )
    }
  }

  /** Reconcile one existing program from its departments and carry it on. */
  private async pickUp(ledger: ProgramLedger, sessions: ReadonlyMap<SessionId, ScannedSession>): Promise<ProgramReport> {
    const preparation = await this.ctx.sessionPersistence.prepare(ledger.sessionId)
    try {
      return await this.publish(preparation.session, async () => {
        const run = this.newRun(ledger.start.programId, ledger.start.spec, preparation.session)
        run.integration = ledger.integration
        for (const state of run.states.values()) {
          const recorded = ledger.goals.get(state.goal.key)
          if (recorded !== undefined) {
            state.status = recorded.status
            state.sessionId = recorded.sessionId
            state.workspace = recorded.workspace
            state.revision = recorded.revision
            state.reason = recorded.reason
          }
          const reconciled = await this.reconcile(run, state, sessions)
          // A goal the ledger never recorded is declared here as well, so a
          // ledger written by a process that died mid-declaration still states
          // every goal of the spec before it states what became of any of them.
          if (recorded === undefined || reconciled) this.record(run, state)
        }
        preparation.session.append('program/resume', {
          programId: run.programId,
          statuses: countStatuses([...run.states.values()].map(state => state.status)),
        })
        await this.ctx.sessions.flush(preparation.session)
        return await this.drive(run)
      })
    } finally {
      preparation[Symbol.dispose]()
    }
  }

  /** The live state of one program before any department of this pass runs. */
  private newRun(programId: ProgramId, spec: FrozenProgramSpec, session: Session): ProgramRun {
    return {
      programId,
      spec,
      session,
      states: new Map(spec.goals.map(goal => [goal.key, {
        goal,
        status: 'pending',
        sessionId: undefined,
        workspace: undefined,
        revision: undefined,
        reason: undefined,
        driving: false,
      }])),
      integration: undefined,
      outcome: undefined,
    }
  }

  /**
   * Bring one goal's state in line with what its department states about
   * itself. The department's own log and worktree are the authority; the ledger
   * record this pass read is only the index that found them.
   * @returns whether the reconciled status differs from the recorded one.
   */
  private async reconcile(
    run: ProgramRun,
    state: DepartmentState,
    sessions: ReadonlyMap<SessionId, ScannedSession>,
  ): Promise<boolean> {
    const before = state.status
    const sessionId = this.departmentSessionId(run.programId, state.goal.key)
    const scanned = sessions.get(sessionId)
    if (scanned === undefined) {
      state.status = 'pending'
      return before !== state.status
    }
    state.sessionId = sessionId
    const workspace = this.worktreePath(run.programId, state.goal.key)
    state.workspace = workspace
    if (!await isDirectory(workspace)) {
      state.status = 'failed'
      state.reason = `the worktree at ${workspace} is gone, so nothing can show what this department delivered`
      return true
    }
    const department = foldDepartmentLog(scanned.events)
    if (department.certified) {
      state.status = 'certified'
      state.revision = await this.head(workspace)
      return before !== state.status
    }
    if (department.phase === 'blocked') {
      state.status = 'blocked'
      state.reason = department.blockedCode
      return before !== state.status
    }
    state.status = 'running'
    return before !== state.status
  }

  /** Append one goal's current state to the ledger. */
  private record(run: ProgramRun, state: DepartmentState): void {
    run.session.append('program/goal', {
      programId: run.programId,
      key: state.goal.key,
      status: state.status,
      ...state.sessionId === undefined ? {} : { sessionId: state.sessionId },
      ...state.workspace === undefined ? {} : { workspace: state.workspace },
      ...state.revision === undefined ? {} : { revision: state.revision },
      ...state.reason === undefined ? {} : { reason: state.reason },
    })
  }

  /** Move one goal to a new status and record it, flushing the ledger. */
  private async transition(run: ProgramRun, state: DepartmentState, status: ProgramGoalStatus, reason?: string): Promise<void> {
    state.status = status
    state.reason = reason
    this.record(run, state)
    await this.ctx.sessions.flush(run.session)
  }

  /** Run departments until none can start, then integrate or close the program. */
  private async drive(run: ProgramRun): Promise<ProgramReport> {
    const running = new Map<string, Promise<void>>()
    let ceilingReached = false
    while (!this.stopping) {
      const runnable = [...run.states.values()].filter(state => !state.driving && this.canRun(run, state))
      for (const state of runnable) {
        if (running.size >= this.config.maxConcurrentGoals) break
        if (await this.overCeiling(run)) {
          ceilingReached = true
          break
        }
        state.driving = true
        running.set(state.goal.key, this.department(run, state).finally(() => {
          state.driving = false
          running.delete(state.goal.key)
        }))
      }
      if (running.size === 0) break
      await Promise.race(running.values())
    }
    await Promise.all(running.values())
    if (this.stopping) return this.report(run)
    return await this.close(run, ceilingReached)
  }

  /** Whether one goal is ready for a department pass right now. */
  private canRun(run: ProgramRun, state: DepartmentState): boolean {
    if (state.status === 'running') return true
    if (state.status !== 'pending') return false
    return state.goal.dependsOn.every((key) => {
      const dependency = run.states.get(key)
      return dependency?.status === 'certified' || dependency?.status === 'merged'
    })
  }

  /** Whether the program's own sessions already spent its ceiling. */
  private async overCeiling(run: ProgramRun): Promise<boolean> {
    const ceiling = run.spec.tokenCeiling
    if (ceiling === undefined) return false
    const { members } = await this.scan()
    return programSpend(members, run.programId) >= ceiling
  }

  /** Integrate a fully certified program, or close one that cannot reach that. */
  private async close(run: ProgramRun, ceilingReached: boolean): Promise<ProgramReport> {
    const states = [...run.states.values()]
    if (states.every(state => state.status === 'certified')) {
      // A process that died between the integration's certificate and the
      // records that follow it finishes the bookkeeping instead of merging
      // the same branches a second time.
      if (run.integration?.status === 'certified') await this.markMerged(run)
      else await this.integrate(run)
    }
    if (states.every(state => state.status === 'merged')) return await this.release(run)
    for (const state of states) {
      if (state.status === 'pending') await this.transition(run, state, 'abandoned', 'the program ended before this goal started')
    }
    run.outcome = ceilingReached ? 'abandoned' : 'failed'
    run.session.append('program/end', { programId: run.programId, outcome: run.outcome })
    await this.ctx.sessions.flush(run.session)
    return this.report(run)
  }

  /** Record the release of a program whose integration certified its merged head. */
  private async release(run: ProgramRun): Promise<ProgramReport> {
    this.requireSignoffRecord(run.spec, run.session.events, 'release', 'release')
    const mergedRevision = run.integration?.mergedRevision
    run.outcome = 'released'
    run.session.append('program/end', {
      programId: run.programId,
      outcome: 'released',
      ...mergedRevision === undefined ? {} : { mergedRevision },
    })
    await this.ctx.sessions.flush(run.session)
    return this.report(run)
  }

  /** Merge every department branch onto the base revision and certify the result. */
  private async integrate(run: ProgramRun): Promise<void> {
    const workspace = this.worktreePath(run.programId, INTEGRATION_KEY)
    const branch = this.branchName(run.programId, INTEGRATION_KEY)
    try {
      await this.ensureWorktree(workspace, branch, run.spec.baseRevision)
    } catch (error: unknown) {
      await this.failIntegration(run, String(error))
      return
    }
    run.integration = { programId: run.programId, status: 'running' }
    run.session.append('program/integration', run.integration)
    await this.ctx.sessions.flush(run.session)
    try {
      for (const key of dependencyOrder(run.spec.goals)) {
        const departmentBranch = this.branchName(run.programId, key)
        await this.git(['merge', '--no-ff', '-m', departmentBranch, departmentBranch], workspace)
      }
    } catch (error: unknown) {
      await this.failIntegration(run, String(error))
      return
    }
    const certified = await this.driveIntegration(run, workspace)
    if (certified) await this.markMerged(run)
  }

  /** Record every goal of a certified integration as merged. */
  private async markMerged(run: ProgramRun): Promise<void> {
    for (const state of run.states.values()) await this.transition(run, state, 'merged', undefined)
  }

  /** Record an integration that could not produce a merged head to certify. */
  private async failIntegration(run: ProgramRun, reason: string): Promise<void> {
    run.integration = { programId: run.programId, status: 'failed', reason }
    run.session.append('program/integration', run.integration)
    await this.ctx.sessions.flush(run.session)
  }

  /** Certify the merged head, letting a model fix it when the checks do not pass as merged. */
  private async driveIntegration(run: ProgramRun, workspace: string): Promise<boolean> {
    const sessionId = this.departmentSessionId(run.programId, INTEGRATION_KEY)
    const handle = await this.createSession(sessionId, workspace, undefined, run.programId, INTEGRATION_KEY)
    try {
      const { agent } = handle
      const goal = this.ctx.goals.create(agent, {
        objective: `Make the merged head of "${run.spec.objective}" pass its integration standard.`,
        maxGoalRounds: this.config.maxGoalRounds,
      })
      this.ctx.goals.disarm(agent)
      this.ctx.completionStandards.author(agent, { goalId: goal.id, checks: integrationChecks(run.spec.integration) })
      await this.ctx.sessions.flush(agent.session)
      // The merge itself is the first candidate: a clean merge whose checks
      // pass needs no model turn at all. The integration is always driven
      // through the model route, whatever staffs the program's departments:
      // making a merged head pass is this harness's own repair work.
      const certified = await this.attempts({
        agent,
        workspace,
        isolation: 'none',
        objective: undefined,
        from: 1,
        work: (prompt): Promise<boolean> => this.turn(agent, prompt),
      })
      if (!certified) {
        await this.failIntegration(run, 'the merged head did not pass the integration standard')
        return false
      }
      const mergedRevision = await this.head(workspace)
      run.integration = { programId: run.programId, status: 'certified', mergedRevision, sessionId }
      run.session.append('program/integration', run.integration)
      await this.ctx.sessions.flush(run.session)
      return true
    } finally {
      await handle.dispose()
    }
  }

  /** Create or resume one department, drive it, and record what it came to. */
  private async department(run: ProgramRun, state: DepartmentState): Promise<void> {
    const { goal } = state
    const workspace = this.worktreePath(run.programId, goal.key)
    const sessionId = this.departmentSessionId(run.programId, goal.key)
    const resuming = state.status === 'running'
    let delegation: ResolvedImplementer | undefined
    let handle: AgentHandle
    try {
      // The staffing is refused before the worktree exists, so a program whose
      // implementer this deployment cannot supply costs no branch and no session.
      delegation = this.resolveImplementer(run.spec.implementer, goal)
      handle = resuming
        ? await this.resumeSession(sessionId, goal.preset)
        : await this.openDepartment(run, state, workspace, sessionId)
    } catch (error: unknown) {
      await this.transition(run, state, 'failed', String(error))
      return
    }
    try {
      await this.driveDepartment(run, state, handle.agent, workspace, resuming, delegation)
    } catch (error: unknown) {
      await this.transition(run, state, 'failed', String(error))
    } finally {
      await handle.dispose()
    }
  }

  /**
   * The staffing one department's attempts run under.
   * @param implementer - the frozen spec's staffing.
   * @param goal - the goal being staffed, whose isolation the provider must support.
   * @returns the resolved provider and label, or `undefined` for a department
   *   this service drives through the model route itself.
   * @throws {@link ProgramError} when the seam or the named provider is absent,
   *   or when an out-of-process provider cannot support the goal's isolation.
   */
  private resolveImplementer(implementer: ProgramImplementer, goal: ProgramGoalSpec): ResolvedImplementer | undefined {
    switch (implementer.kind) {
      case 'route':
        return undefined
      case 'subagent': {
        const subagents = this.ctx.get('subagents')
        const provider = subagents?.getProvider(implementer.provider)
        if (subagents === undefined || provider === undefined) {
          throw new ProgramError(
            `this program delegates its departments to the subagent provider "${implementer.provider}", which this deployment does not compose`,
            'PROGRAM_IMPLEMENTER_UNAVAILABLE',
          )
        }
        if (goal.isolation !== 'none' && outOfProcess(provider)) {
          throw new ProgramError(
            `goal "${goal.key}" claims "${goal.isolation}" isolation, which no department delegated to the out-of-process provider "${implementer.provider}" can support`,
            'PROGRAM_IMPLEMENTER_ISOLATION',
          )
        }
        return {
          subagents,
          provider: implementer.provider,
          ...implementer.label === undefined ? {} : { label: implementer.label },
        }
      }
      /* v8 ignore next 2 -- ProgramImplementer is a closed union validated at
       * the spec boundary; this arm is only the static exhaustiveness guard. */
      default:
        return assertNever(implementer)
    }
  }

  /** Mint one department's worktree and session, then record it as running. */
  private async openDepartment(
    run: ProgramRun,
    state: DepartmentState,
    workspace: string,
    sessionId: SessionId,
  ): Promise<AgentHandle> {
    const { goal } = state
    await this.ensureWorktree(workspace, this.branchName(run.programId, goal.key), run.spec.baseRevision)
    const handle = await this.createSession(sessionId, workspace, goal.preset, run.programId, goal.key)
    const { agent } = handle
    try {
      agent.session.append('budget/caps', goal.budget)
      const created = this.ctx.goals.create(agent, { objective: goal.objective, maxGoalRounds: this.config.maxGoalRounds })
      this.ctx.goals.disarm(agent)
      this.ctx.completionStandards.author(agent, { goalId: created.id, checks: goal.checks })
      await this.ctx.sessions.flush(agent.session)
    } catch (error: unknown) {
      await handle.dispose()
      throw error
    }
    state.sessionId = sessionId
    state.workspace = workspace
    await this.transition(run, state, 'running', undefined)
    return handle
  }

  /** Drive one department's attempts until it certifies, blocks, or runs out of rounds. */
  private async driveDepartment(
    run: ProgramRun,
    state: DepartmentState,
    agent: Agent,
    workspace: string,
    resuming: boolean,
    delegation: ResolvedImplementer | undefined,
  ): Promise<void> {
    // A department whose goal is blocked is never driven: the reconciliation
    // routes it to `blocked` and waits for an operator's own resume.
    const current = this.ctx.goals.get(agent)
    if (current === undefined) {
      await this.transition(run, state, 'failed', 'the department session carries no goal')
      return
    }
    if (resuming) {
      // A department loaded from persistence starts disarmed; the resume edge
      // is the durable record that this process took it back over, and the
      // disarm that follows keeps the attempts this service's rather than the
      // goal-round driver's. A goal the previous process completed without a
      // certificate cannot be resumed, and fails the department loudly.
      this.ctx.goals.resume(agent, { id: current.id, revision: current.revision })
      this.ctx.goals.disarm(agent)
    }
    const certified = await this.attempts({
      agent,
      workspace,
      isolation: state.goal.isolation,
      objective: state.goal.objective,
      // A delegated attempt that already ended is recorded, and this pass
      // continues after it rather than running it a second time.
      from: foldDepartmentLog(agent.session.events).delegated + 1,
      work: delegation === undefined
        ? (prompt): Promise<boolean> => this.turn(agent, prompt)
        : (prompt, attempt): Promise<boolean> => this.delegate(agent, delegation, state.goal.key, prompt, attempt),
    })
    const settled = this.ctx.goals.get(agent)
    if (settled?.phase === 'blocked') {
      await this.transition(run, state, 'blocked', settled.blockedReason?.code)
      return
    }
    if (!certified) {
      await this.transition(run, state, 'failed', `no certificate after ${String(this.config.maxGoalRounds)} rounds`)
      return
    }
    state.revision = await this.head(workspace)
    await this.transition(run, state, 'certified', undefined)
  }

  /** Deliver one attempt as a user turn to the department this service drives itself. */
  private async turn(agent: Agent, prompt: string): Promise<boolean> {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
    await agent.whenIdle()
    return this.ctx.goals.get(agent)?.phase !== 'blocked'
  }

  /**
   * Run one attempt of a delegated department as one child of the external
   * coding agent and record what it came to. The provider derives the child's
   * working directory from the department session's own `cwd`, which is the
   * department worktree, so the child works on the department branch.
   * @param agent - the department session, which is the child's delegating parent.
   * @param delegation - the resolved provider and label, already checked against the goal's isolation.
   * @param goalKey - the goal this department delivers, recorded with the run.
   * @param prompt - the goal text on the first attempt, the check-failure text after.
   * @param attempt - the 1-based attempt this run serves.
   * @returns `true`, because a run that ended without completing still leaves a
   *   tree the department's checks measure.
   */
  private async delegate(
    agent: Agent,
    delegation: ResolvedImplementer,
    goalKey: string,
    prompt: string,
    attempt: number,
  ): Promise<boolean> {
    const child = await delegation.subagents.start(delegation.provider, {
      prompt: [{ type: 'text', text: prompt }],
      parent: agent,
      signal: this.teardown.signal,
      ...delegation.label === undefined ? {} : { label: delegation.label },
    })
    try {
      const result = await child.result
      agent.session.append('program/delegation', {
        goalKey,
        attempt,
        provider: delegation.provider,
        runId: child.id,
        stopReason: result.stopReason,
        ...result.structured === undefined ? {} : { structured: result.structured },
        ...this.delegationUsage(child.localAgent),
      })
      await this.ctx.sessions.flush(agent.session)
    } finally {
      await child.dispose()
    }
    return true
  }

  /** What one delegated attempt cost, for a child whose own session this process holds. */
  private delegationUsage(child: Agent | undefined): { usage?: ProgramDelegationUsage } {
    if (child === undefined) return {}
    return { usage: { totalTokens: foldBudgetSpend(child.session.events, {}).totalTokens } }
  }

  /**
   * Run the session's standard against its workspace, letting the attempt's own
   * work happen between runs, until it certifies or the round cap is spent.
   * @param plan - the session, worktree, isolation claim, first prompt, first
   *   attempt, and the work one attempt does.
   * @returns whether a run certified the standard.
   */
  private async attempts(plan: AttemptPlan): Promise<boolean> {
    const { agent, workspace } = plan
    let prompt = plan.objective
    for (let round = plan.from; round <= this.config.maxGoalRounds; round += 1) {
      if (prompt !== undefined && !await plan.work(prompt, round)) return false
      const standard = this.ctx.completionStandards.get(agent)
      if (standard === undefined) return false
      const ref = { id: standard.id, revision: standard.revision }
      const results = await this.execute(standard.checks, workspace)
      const outcome = this.ctx.completionStandards.recordRun(agent, ref, plan.isolation, results, { executor: 'runner' })
      await this.ctx.sessions.flush(agent.session)
      if (outcome.certified) {
        const goal = this.ctx.goals.get(agent)
        if (goal !== undefined) this.ctx.goals.complete(agent, { id: goal.id, revision: goal.revision })
        await this.ctx.sessions.flush(agent.session)
        return true
      }
      this.ctx.completionStandards.issueDirective(agent, ref, {
        rootCause: `${String(outcome.failures.length)} of this goal's checks did not pass`,
        detail: bounded(outcome.failures.map(failure => `${failure.checkId}: ${failure.evidence}`).join('\n'), this.config.evidenceMaxChars),
      })
      prompt = retryText(outcome.failures)
    }
    return false
  }

  /** Run every active check in order through the shell executor rooted at the worktree. */
  private async execute(checks: readonly StandardCheck[], workspace: string): Promise<CheckResult[]> {
    const results: CheckResult[] = []
    for (const check of checks) {
      const result = await this.ctx.shell.run(this.ctx.shell.resolve({ command: check.run, workdir: workspace }))
      results.push({
        checkId: check.id,
        status: passed(result) ? 'pass' : 'fail',
        evidence: bounded(outcomeOf(result), this.config.evidenceMaxChars),
      })
    }
    return results
  }

  /**
   * The model route and the preset composition every member session of a
   * program is created or resumed with.
   * @param preset - the preset to mount, or `undefined` for the roster's default.
   * @returns the agent options and the setup transaction to spread into a create or resume.
   */
  private composition(preset: string | undefined): { agentOptions: AgentOptions; setup: AgentSetup } {
    const model = this.ctx.agentDefaultModel.currentSelection()
    return {
      agentOptions: { provider: model.provider, model: model.model },
      setup: async (agentCtx) => {
        await this.ctx.agentPresets.mount(agentCtx, preset)
        installModelSelection(agentCtx, { current: { provider: model.provider, model: model.model }, assembled: undefined })
      },
    }
  }

  /** Create one member session over its worktree, stamped with the program it belongs to. */
  private async createSession(
    sessionId: SessionId,
    workspace: string,
    preset: string | undefined,
    programId: ProgramId,
    key: string,
  ): Promise<AgentHandle> {
    const handle = await this.ctx.agents.create({
      sessionId,
      meta: { cwd: workspace },
      ...this.composition(preset),
    })
    await this.reserve(handle)
    handle.agent.session.append('program/member', { programId, key })
    return handle
  }

  /** Resume one department's session over the worktree its header already names. */
  private async resumeSession(sessionId: SessionId, preset: string): Promise<AgentHandle> {
    const handle = await this.ctx.agents.resume({ resumeSessionId: sessionId, ...this.composition(preset) })
    await this.reserve(handle)
    return handle
  }

  /** Let one fresh handle settle, then record its session as the barrier's implementer. */
  private async reserve(handle: AgentHandle): Promise<void> {
    await handle.agent.whenIdle()
    this.ctx.get('readBarrier')?.reserve(handle.agent)
  }

  /** The absolute worktree path of one key of one program. */
  private worktreePath(programId: ProgramId, key: string): string {
    return join(this.config.workspaceRoot, programId, key)
  }

  /** The branch one key of one program is delivered on. */
  private branchName(programId: ProgramId, key: string): string {
    return `${this.config.branchPrefix}/${programId}/${key}`
  }

  /** The session id one key of one program uses; it is derived, so no key ever gets two. */
  private departmentSessionId(programId: ProgramId, key: string): SessionId {
    return SessionId(`${programId}-${key}`)
  }

  /** Add the worktree for one branch, reusing the directory when it is already there. */
  private async ensureWorktree(workspace: string, branch: string, revision: string): Promise<void> {
    if (await isDirectory(workspace)) return
    await this.git(['worktree', 'add', '-B', branch, workspace, revision], this.config.workspaceRoot)
  }

  /** The commit one worktree currently has checked out. */
  private async head(workspace: string): Promise<string> {
    return await this.git(['rev-parse', 'HEAD'], workspace)
  }

  /**
   * Run one git command through the composed shell.
   * @param args - the command words, each already free of shell metacharacters.
   * @param workdir - the directory the command runs in.
   * @returns the trimmed standard output.
   * @throws {@link ProgramError} when the command did not exit zero.
   */
  private async git(args: readonly string[], workdir: string): Promise<string> {
    const command = ['git', ...args].join(' ')
    const result = await this.ctx.shell.run(this.ctx.shell.resolve({ command, workdir }))
    if (!passed(result)) {
      throw new ProgramError(`"${command}" in ${workdir} failed: ${outcomeOf(result)}`, 'PROGRAM_GIT_FAILED')
    }
    return result.stdout.text.trim()
  }

  /**
   * Publish one program session for the length of the pass, flush it, and
   * detach. The entry is owned by this fiber, so a disposal that races a pass
   * removes it after {@link ProgramService.settle} has let the pass settle.
   */
  private async publish(session: Session, body: () => Promise<ProgramReport>): Promise<ProgramReport> {
    const detach = this.ctx.effect(function* (this: ProgramService) {
      yield this.ctx.sessions.enter(session)
      this.ctx.sessions.announce(session)
    }.bind(this), `programs.session(${session.id})`)
    try {
      return await body()
    } finally {
      await this.ctx.sessions.flush(session)
      await detach()
    }
  }

  /** The report one pass leaves behind. */
  private report(run: ProgramRun): ProgramReport {
    return {
      programId: run.programId,
      sessionId: run.session.id,
      ...run.outcome === undefined ? {} : { outcome: run.outcome },
      ...run.integration?.mergedRevision === undefined ? {} : { mergedRevision: run.integration.mergedRevision },
      goals: run.spec.goals.map((goal) => {
        const state = run.states.get(goal.key) as DepartmentState
        return {
          key: goal.key,
          status: state.status,
          ...state.sessionId === undefined ? {} : { sessionId: state.sessionId },
          ...state.revision === undefined ? {} : { revision: state.revision },
          ...state.reason === undefined ? {} : { reason: state.reason },
        }
      }),
    }
  }

  /** The report of a program whose ledger already carries its closing record. */
  private finishedReport(ledger: ProgramLedger): ProgramReport {
    const end = ledger.end as ProgramEnd
    return {
      programId: ledger.start.programId,
      sessionId: ledger.sessionId,
      outcome: end.outcome,
      ...end.mergedRevision === undefined ? {} : { mergedRevision: end.mergedRevision },
      goals: ledger.start.spec.goals.map((goal) => {
        const recorded = ledger.goals.get(goal.key)
        return {
          key: goal.key,
          status: recorded?.status ?? 'pending',
          ...recorded?.sessionId === undefined ? {} : { sessionId: recorded.sessionId },
          ...recorded?.revision === undefined ? {} : { revision: recorded.revision },
          ...recorded?.reason === undefined ? {} : { reason: recorded.reason },
        }
      }),
    }
  }
}

export default ProgramService
