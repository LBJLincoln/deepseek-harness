/**
 * Environment runner: the automated validator that runs one registered
 * environment as one fresh session. It stamps the session with the
 * environment it runs, authors the completion standard from the environment's
 * checks, drives the implementer turn by turn, restores the fixture and
 * executes the checks through the shell executor after each turn, records the
 * run, and completes the goal only under a certificate. The
 * [environment-runner Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-environment-runner.md)
 * owns the design rationale.
 * @module @deepseek-ai/dsh-environment-runner
 */

import { createHash, randomUUID } from 'node:crypto'
import { cp, readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { ENVIRONMENT_RUN_VERSION, environmentContentHashes } from '@deepseek-ai/dsh-environments'
import type { EnvironmentDefinition, EnvironmentRunModel, EnvironmentRunStamp } from '@deepseek-ai/dsh-environments/types'
import type {} from '@deepseek-ai/dsh-goal'
import type { GoalId } from '@deepseek-ai/dsh-goal/types'
import { createUserMessage, HarnessError } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ShellRunResult } from '@deepseek-ai/dsh-shell'
import type {} from '@deepseek-ai/dsh-verification'
import type {
  CertificateIsolation,
  CheckResult,
  DirectiveRequest,
  StandardCheck,
  StandardView,
  VerificationCertificate,
} from '@deepseek-ai/dsh-verification/types'
import type { EnvironmentRunAttempt, EnvironmentRunReport, EnvironmentRunRequest } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    environmentRuns: EnvironmentRunner
  }
}

/** Stable error codes of a refused or broken run. */
export type EnvironmentRunErrorCode =
  | 'ENVIRONMENT_RUN_UNKNOWN_ENVIRONMENT'
  | 'ENVIRONMENT_RUN_INVALID_WORKSPACE'
  | 'ENVIRONMENT_RUN_INVALID_FIXTURE'
  | 'ENVIRONMENT_RUN_GOAL_REPLACED'
  | 'ENVIRONMENT_RUN_STANDARD_LOST'

/** Error returned by the environment runner boundary. */
export class EnvironmentRunError extends HarnessError {
  /**
   * @param message - human-readable reason.
   * @param code - stable machine-routable classification.
   */
  // Keep the constructor to narrow HarnessError's string code at this boundary.
  // oxlint-disable-next-line typescript/no-useless-constructor -- type-only narrowing
  constructor(message: string, code: EnvironmentRunErrorCode) {
    super(message, code)
  }
}

/** Deployment choices of the runner, validated from `cordis.yml`. */
export interface Config {
  /** Isolation the deployment can defend for its check runs; written into every certificate and stamp. */
  isolation: CertificateIsolation
  /** Implementer turns before the run is reported uncertified; each is followed by one validation. */
  maxAttempts?: number
  /** Round cap handed to goal creation; absent applies the goal service default. */
  maxGoalRounds?: number
  /** Timeout override for each check command, capped by the executor; absent applies the executor default. */
  checkTimeoutMs?: number
  /** Bound of each evidence string and of the directive detail. */
  evidenceMaxChars?: number
}

/** The runner's choices with every default applied. */
export interface ResolvedConfig {
  readonly isolation: CertificateIsolation
  readonly maxAttempts: number
  readonly maxGoalRounds: number | undefined
  readonly checkTimeoutMs: number | undefined
  readonly evidenceMaxChars: number
}

/**
 * Apply the runner's defaults to a validated config.
 * @param config - validated deployment config.
 * @returns the resolved choices: one attempt and 2000 evidence characters unless configured.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  return {
    isolation: config.isolation,
    maxAttempts: config.maxAttempts ?? 1,
    maxGoalRounds: config.maxGoalRounds,
    checkTimeoutMs: config.checkTimeoutMs,
    evidenceMaxChars: config.evidenceMaxChars ?? 2000,
  }
}

/** Directory test that treats a missing or unreadable path as no directory. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    // stat rejects for a missing or unreadable path; both mean the caller named no usable directory.
    return false
  }
}

/** SHA-256 over every regular file under a directory: relative POSIX path, then bytes, in sorted order. */
async function hashDirectory(root: string): Promise<string> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  const files = entries.filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)).sort()
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(relative(root, file).split(sep).join('/')).update('\0').update(await readFile(file)).update('\0')
  }
  return hash.digest('hex')
}

/**
 * Reject a workspace or fixture that is not an existing absolute directory,
 * then overlay the fixture and return its digest.
 * @returns the fixture digest, or `undefined` for a task without a fixture.
 */
async function prepareWorkspace(workspace: string, fixture: string | undefined): Promise<string | undefined> {
  if (!isAbsolute(workspace) || !await isDirectory(workspace)) {
    throw new EnvironmentRunError(`workspace "${workspace}" is not an existing absolute directory`, 'ENVIRONMENT_RUN_INVALID_WORKSPACE')
  }
  if (fixture === undefined) return undefined
  if (!isAbsolute(fixture) || !await isDirectory(fixture)) {
    throw new EnvironmentRunError(`fixture "${fixture}" is not an existing absolute directory`, 'ENVIRONMENT_RUN_INVALID_FIXTURE')
  }
  await cp(fixture, workspace, { recursive: true })
  return hashDirectory(fixture)
}

/**
 * Overlay the fixture again so implementer edits to validator-owned files do
 * not reach the checks, then digest the workspace the validation will read.
 * @param workspace - the run's workspace directory.
 * @param fixture - the task fixture, absent for a task without one.
 * @returns the workspace digest as the validation begins.
 */
async function restoreFixture(workspace: string, fixture: string | undefined): Promise<string> {
  if (fixture !== undefined) await cp(fixture, workspace, { recursive: true })
  return hashDirectory(workspace)
}

/** Whether one executed check passed: a zero exit that neither timed out nor was aborted. */
function passed(result: ShellRunResult): boolean {
  return result.exitCode === 0 && !result.timedOut && !result.aborted
}

/** Keep the first line and the tail of longer text inside the bound. */
function bound(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const newline = text.indexOf('\n')
  const head = newline === -1 ? text : text.slice(0, newline)
  const marker = '\n…'
  const tailBudget = maxChars - head.length - marker.length
  if (tailBudget <= 0) return text.slice(0, maxChars)
  return `${head}${marker}${text.slice(-tailBudget)}`
}

/** Render one executed check's evidence: the exit fact, then the bounded output tails. */
function evidenceOf(result: ShellRunResult, maxChars: number): string {
  const exit = result.exitCode === null ? `terminated by ${result.signal ?? 'an unknown signal'}` : `exit ${result.exitCode}`
  const cause = result.timedOut ? ` after the ${result.timeoutMs}ms timeout` : result.aborted ? ' after the run was aborted' : ''
  const lines = [`${exit}${cause}`]
  if (result.stdout.text !== '') lines.push(`stdout: ${result.stdout.text.trimEnd()}`)
  if (result.stderr.text !== '') lines.push(`stderr: ${result.stderr.text.trimEnd()}`)
  return bound(lines.join('\n'), maxChars)
}

/** One directive per failed run: the count as root cause, the evidence as detail, never the checks themselves. */
function describeFailures(failures: readonly CheckResult[], maxChars: number): DirectiveRequest {
  return {
    rootCause: `${failures.length} of the standard's checks failed`,
    detail: bound(failures.map((failure, index) => `${index + 1}. ${failure.evidence}`).join('\n'), maxChars),
  }
}

/** The validator's follow-up turn after a failed run; the text is pinned by the runner README and its e2e. */
function followupText(directive: DirectiveRequest): string {
  return `<validation_failed>\n${directive.rootCause}\n${directive.detail}\nContinue working on the task; the validator runs again when you stop.\n</validation_failed>`
}

/** Sum the usage of every assistant message in a session log. */
function totalUsage(events: readonly SessionEvent[]): TokenUsage | undefined {
  const steps = events.flatMap(event => (
    event.type === 'assistant/message' && event.data.usage !== undefined ? [event.data.usage] : []
  ))
  if (steps.length === 0) return undefined
  const total: TokenUsage = {
    inputTokens: steps.reduce((sum, step) => sum + step.inputTokens, 0),
    outputTokens: steps.reduce((sum, step) => sum + step.outputTokens, 0),
  }
  for (const key of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const) {
    const values = steps.flatMap((step) => {
      const value = step[key]
      return value === undefined ? [] : [value]
    })
    if (values.length > 0) total[key] = values.reduce((sum, value) => sum + value, 0)
  }
  return total
}

/** Environment runner (`ctx.environmentRuns`): one registered environment as one validated session. */
export class EnvironmentRunner extends Service {
  static inject = ['environments', 'agents', 'agentDefaultModel', 'goals', 'completionStandards', 'shell', 'sessions']

  static Config: z<Config> = z.object({
    isolation: z.union(['none', 'process', 'host'] as const).required(),
    maxAttempts: z.natural().min(1).default(1),
    maxGoalRounds: z.natural().min(1),
    checkTimeoutMs: z.natural().min(1),
    evidenceMaxChars: z.natural().min(1).default(2000),
  })

  private readonly resolved: ResolvedConfig

  constructor(ctx: Context, config: Config) {
    super(ctx, 'environmentRuns')
    this.resolved = resolveConfig(config)
  }

  /**
   * Run one environment as one fresh session and validate it.
   * @param request - environment id, absolute workspace directory, optional model route, repetition, group, and abort signal.
   * @returns the stamp, the attempts, the certificate when one run passed, and the accumulated usage.
   * @throws {@link EnvironmentRunError} for an unknown environment, an unusable
   *   workspace or fixture, an implementer that replaced the goal, or a lost standard.
   */
  async run(request: EnvironmentRunRequest): Promise<EnvironmentRunReport> {
    const definition = this.ctx.environments.get(request.environment)
    if (definition === undefined) {
      throw new EnvironmentRunError(`environment "${request.environment}" is not registered`, 'ENVIRONMENT_RUN_UNKNOWN_ENVIRONMENT')
    }
    const fixtureSha256 = await prepareWorkspace(request.workspace, definition.task.fixture)
    const model = request.model ?? this.defaultModel()
    const stamp: EnvironmentRunStamp = {
      kind: 'environment/run',
      version: ENVIRONMENT_RUN_VERSION,
      environmentId: definition.id,
      environmentKind: definition.kind,
      heldOut: definition.heldOut,
      ...environmentContentHashes(definition, fixtureSha256),
      repetition: request.repetition ?? 0,
      ...request.group === undefined ? {} : { group: request.group },
      model,
      isolation: this.resolved.isolation,
    }
    const handle = await this.ctx.agents.create({
      sessionId: SessionId(`environment-${randomUUID()}`),
      meta: { cwd: request.workspace },
      agentOptions: { provider: model.provider, model: model.model },
      ...request.signal === undefined ? {} : { signal: request.signal },
      setup: (agentCtx) => {
        installModelSelection(agentCtx, { current: { provider: model.provider, model: model.model }, assembled: undefined })
      },
    })
    try {
      return await this.drive(handle.agent, definition, stamp, request)
    } finally {
      await handle.dispose()
    }
  }

  /** The composition's default model route, detached from the selection service. */
  private defaultModel(): EnvironmentRunModel {
    const selection = this.ctx.agentDefaultModel.currentSelection()
    return { provider: selection.provider, model: selection.model }
  }

  /** Stamp, goal, standard, then the attempt loop; the session is flushed on every path. */
  private async drive(
    agent: Agent,
    definition: EnvironmentDefinition,
    stamp: EnvironmentRunStamp,
    request: EnvironmentRunRequest,
  ): Promise<EnvironmentRunReport> {
    const { goals, completionStandards, sessions } = this.ctx
    await agent.whenIdle()
    agent.session.append('environment/run', stamp)
    const goal = goals.create(agent, {
      objective: definition.task.prompt,
      ...this.resolved.maxGoalRounds === undefined ? {} : { maxGoalRounds: this.resolved.maxGoalRounds },
    })
    goals.disarm(agent)
    completionStandards.author(agent, { goalId: goal.id, checks: definition.checks })
    const attempts: EnvironmentRunAttempt[] = []
    let certificate: VerificationCertificate | undefined
    let prompt = definition.task.prompt
    try {
      for (let attempt = 1; attempt <= this.resolved.maxAttempts; attempt += 1) {
        agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
        await agent.whenIdle()
        const standard = this.currentStandard(agent, goal.id)
        const treeHash = await restoreFixture(request.workspace, definition.task.fixture)
        const results = await this.execute(standard.checks, request)
        attempts.push({ attempt, results, treeHash })
        const ref = { id: standard.id, revision: standard.revision }
        const outcome = completionStandards.recordRun(agent, ref, this.resolved.isolation, results, {
          executor: 'runner',
          treeHash,
        })
        if (outcome.certified) {
          certificate = outcome.certificate
          const current = goals.get(agent)
          if (current === undefined || current.id !== goal.id) {
            throw new EnvironmentRunError(`the implementer replaced goal "${goal.id}"`, 'ENVIRONMENT_RUN_GOAL_REPLACED')
          }
          goals.complete(agent, { id: current.id, revision: current.revision })
          break
        }
        const directive = describeFailures(outcome.failures, this.resolved.evidenceMaxChars)
        completionStandards.issueDirective(agent, ref, directive)
        prompt = followupText(directive)
      }
    } finally {
      await sessions.flush(agent.session)
    }
    const usage = totalUsage(agent.session.events)
    return {
      environment: definition.id,
      sessionId: agent.id,
      stamp,
      attempts,
      certified: certificate !== undefined,
      ...certificate === undefined ? {} : { certificate },
      ...usage === undefined ? {} : { usage },
    }
  }

  /** The standard the run measures; the implementer cannot mutate it, so another goal's standard or none is an anomaly. */
  private currentStandard(agent: Agent, goalId: GoalId): StandardView {
    const standard = this.ctx.completionStandards.get(agent)
    if (standard === undefined || standard.goalId !== goalId) {
      throw new EnvironmentRunError(`the standard for goal "${goalId}" is no longer current`, 'ENVIRONMENT_RUN_STANDARD_LOST')
    }
    return standard
  }

  /** Run every active check in order through the shell executor rooted at the workspace. */
  private async execute(checks: readonly StandardCheck[], request: EnvironmentRunRequest): Promise<CheckResult[]> {
    const results: CheckResult[] = []
    for (const check of checks) {
      const spec = this.ctx.shell.resolve({
        command: check.run,
        workdir: request.workspace,
        timeoutMs: this.resolved.checkTimeoutMs,
        signal: request.signal,
      })
      const result = await this.ctx.shell.run(spec)
      results.push({
        checkId: check.id,
        status: passed(result) ? 'pass' : 'fail',
        evidence: evidenceOf(result, this.resolved.evidenceMaxChars),
      })
    }
    return results
  }
}

export default EnvironmentRunner
