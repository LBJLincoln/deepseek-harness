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
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentSampling } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { ENVIRONMENT_RUN_VERSION, environmentContentHashes, isSeed } from '@deepseek-ai/dsh-environments'
import type { EnvironmentDefinition, EnvironmentRunModel, EnvironmentRunStamp } from '@deepseek-ai/dsh-environments/types'
import type {} from '@deepseek-ai/dsh-goal'
import type { GoalId } from '@deepseek-ai/dsh-goal/types'
import { assertNever, createUserMessage, HarnessError } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-read-barrier'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ShellExecSpec, ShellRunResult } from '@deepseek-ai/dsh-shell'
import { caseChannelDigest, CHECK_CASE_CHANNELS, normalizeCaseBytes } from '@deepseek-ai/dsh-verification'
import type {
  CaseExitClass,
  CertificateIsolation,
  CheckCase,
  CheckCaseChannel,
  CheckCaseNormalizer,
  CheckResult,
  DirectiveCluster,
  DirectiveRequest,
  FailedCheckCase,
  StandardCheck,
  StandardRef,
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
  | 'ENVIRONMENT_RUN_INVALID_SEED'
  | 'ENVIRONMENT_RUN_INVALID_WORKSPACE'
  | 'ENVIRONMENT_RUN_INVALID_FIXTURE'
  | 'ENVIRONMENT_RUN_UNSAFE_CHECK_SCRIPT'
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
  /** Timeout override for each check command and each case, capped by the executor; absent applies the executor default. */
  checkTimeoutMs?: number
  /** Bound of each evidence string and of the directive detail. */
  evidenceMaxChars?: number
  /** Maximum failed cases one check result lists; the rest are counted and not named. */
  maxFailedCases?: number
  /**
   * Nucleus-sampling mass between 0 and 1 every request of every run asks for.
   * It is a deployment choice rather than a per-run one: a suite compares runs
   * only while every cell samples the same way. Absent leaves the
   * composition's own sampling in place.
   */
  topP?: number
}

/** The runner's choices with every default applied. */
export interface ResolvedConfig {
  readonly isolation: CertificateIsolation
  readonly maxAttempts: number
  readonly maxGoalRounds: number | undefined
  readonly checkTimeoutMs: number | undefined
  readonly evidenceMaxChars: number
  readonly maxFailedCases: number
  readonly topP: number | undefined
}

/**
 * Apply the runner's defaults to a validated config.
 * @param config - validated deployment config.
 * @returns the resolved choices: one attempt, 2000 evidence characters, and 20 listed failed cases unless configured.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  return {
    isolation: config.isolation,
    maxAttempts: config.maxAttempts ?? 1,
    maxGoalRounds: config.maxGoalRounds,
    checkTimeoutMs: config.checkTimeoutMs,
    evidenceMaxChars: config.evidenceMaxChars ?? 2000,
    maxFailedCases: config.maxFailedCases ?? 20,
    topP: config.topP,
  }
}

/**
 * Characters a reserved check script's path may contain. The script is sourced
 * as the second word of the check command line, so the path must need no shell
 * quoting: quoting is dialect-specific and the runner does not know the composed
 * shell's dialect.
 */
const UNQUOTED_COMMAND_WORD = /^[A-Za-z0-9_@%+=:,./\\-]+$/

/** Key the check-owned digest records the reservation's tree under. */
const RESERVATION_KEY = '<reservation>'

/** Subdirectory of a reservation holding one directory per check. */
const CHECKS_DIR = 'checks'
/** File inside a check's reserved directory holding its run instruction. */
const RUN_FILE = 'run'
/** File inside a check's reserved directory holding one case body per line. */
const CASES_FILE = 'cases.jsonl'
/** Reservation file holding the standard the current attempt measures. */
const STANDARD_FILE = 'standard.json'
/** Reservation subdirectory holding a held-out environment's fixture. */
const FIXTURE_DIR = 'fixture'

/** A check id usable as one path segment of its reserved directory. */
const SAFE_CHECK_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Absolute path of one check's reserved directory, which holds its run script
 * and its case bodies. A check id that is not a single path segment, and a
 * script path the check command line cannot carry unquoted, are both refused.
 * @param runDirectory - the reservation the barrier minted for this run.
 * @param checkId - the check's id, used verbatim as the directory's name.
 * @returns the absolute check directory.
 * @throws {@link EnvironmentRunError} when the id or the resulting path is unusable.
 */
function checkDirectory(runDirectory: string, checkId: string): string {
  if (!SAFE_CHECK_SEGMENT.test(checkId)) {
    throw new EnvironmentRunError(`check "${checkId}" cannot name a reserved script file`, 'ENVIRONMENT_RUN_UNSAFE_CHECK_SCRIPT')
  }
  const directory = join(runDirectory, CHECKS_DIR, checkId)
  if (!UNQUOTED_COMMAND_WORD.test(join(directory, RUN_FILE))) {
    throw new EnvironmentRunError(`reserved check script "${join(directory, RUN_FILE)}" contains characters the check command line cannot carry unquoted`, 'ENVIRONMENT_RUN_UNSAFE_CHECK_SCRIPT')
  }
  return directory
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

/**
 * SHA-256 over every regular file under a directory: relative POSIX path, then
 * bytes, in sorted order. A case's `tree` channel passes its comparator's
 * normalizers, which are applied to each file's bytes before they are digested.
 */
async function hashDirectory(root: string, normalizers: readonly CheckCaseNormalizer[] = []): Promise<string> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  const files = entries.filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)).sort()
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(relative(root, file).split(sep).join('/')).update('\0')
      .update(normalizeCaseBytes(await readFile(file), normalizers)).update('\0')
  }
  return hash.digest('hex')
}

/** What one check-owned path digests to when nothing is there to read. */
const ABSENT_DIGEST = 'absent'

/**
 * SHA-256 over one check-owned path: its tree when a directory, its bytes when
 * a file, and {@link ABSENT_DIGEST} when it is gone. Deleting a declared path
 * is as much a change to the check-owned set as rewriting it.
 * @param path - absolute path to digest.
 * @returns the digest, or the absent marker.
 */
async function hashCheckOwnedPath(path: string): Promise<string> {
  if (await isDirectory(path)) return hashDirectory(path)
  try {
    return createHash('sha256').update(await readFile(path)).digest('hex')
  } catch {
    // readFile rejects for a missing or unreadable path; either way the run
    // cannot read what the fixture supplied, which is the change to record.
    return ABSENT_DIGEST
  }
}

/**
 * SHA-256 over the whole check-owned set: the validator's reserved directory,
 * when a barrier minted one, and every path the environment declared immutable,
 * each keyed by the name it is declared under.
 * @param workspace - the run's workspace directory, which immutable paths are relative to.
 * @param runDirectory - the reservation, absent when no barrier is composed.
 * @param immutable - the environment's declared immutable paths.
 * @returns one digest over the whole set.
 */
async function hashCheckOwned(
  workspace: string,
  runDirectory: string | undefined,
  immutable: readonly string[],
): Promise<string> {
  const hash = createHash('sha256')
  if (runDirectory !== undefined) {
    hash.update(RESERVATION_KEY).update('\0').update(await hashDirectory(runDirectory)).update('\0')
  }
  for (const path of immutable) {
    hash.update(path).update('\0').update(await hashCheckOwnedPath(join(workspace, path))).update('\0')
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

/**
 * Write the attempt's standard snapshot, one run script per active check, and
 * each cased check's bodies into the reservation, so what the checks execute
 * and what they measure live where the implementer cannot read them. The whole
 * reservation is inside the check-owned digest, which is what covers the case
 * bodies against tampering.
 * @param runDirectory - the reservation, absent when no barrier is composed.
 * @param standard - the standard this attempt measures.
 * @param bodies - case bodies per check id, from the environment definition.
 * @returns the script path per check id; empty without a reservation.
 * @throws {@link EnvironmentRunError} when a check id cannot name a script file.
 */
async function materializeChecks(
  runDirectory: string | undefined,
  standard: StandardView,
  bodies: ReadonlyMap<string, readonly CheckCase[]>,
): Promise<Map<string, string>> {
  const scripts = new Map<string, string>()
  if (runDirectory === undefined) return scripts
  await mkdir(join(runDirectory, CHECKS_DIR), { recursive: true, mode: 0o700 })
  await writeFile(join(runDirectory, STANDARD_FILE), `${JSON.stringify(standard, null, 2)}\n`, { mode: 0o600 })
  for (const check of standard.checks) {
    const directory = checkDirectory(runDirectory, check.id)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const script = join(directory, RUN_FILE)
    await writeFile(script, `${check.run}\n`, { mode: 0o600 })
    const cases = bodies.get(check.id)
    if (cases !== undefined) {
      await writeFile(
        join(directory, CASES_FILE),
        cases.map(body => `${JSON.stringify(body)}\n`).join(''),
        { mode: 0o600 },
      )
    }
    scripts.set(check.id, script)
  }
  return scripts
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

/** How one command ended, as the evidence states it. */
function exitLine(result: ShellRunResult): string {
  const exit = result.exitCode === null ? `terminated by ${result.signal ?? 'an unknown signal'}` : `exit ${result.exitCode}`
  const cause = result.timedOut ? ` after the ${result.timeoutMs}ms timeout` : result.aborted ? ' after the run was aborted' : ''
  return `${exit}${cause}`
}

/** The captured output tails of one command, omitting an empty stream. */
function outputLines(result: ShellRunResult): string[] {
  const lines: string[] = []
  if (result.stdout.text !== '') lines.push(`stdout: ${result.stdout.text.trimEnd()}`)
  if (result.stderr.text !== '') lines.push(`stderr: ${result.stderr.text.trimEnd()}`)
  return lines
}

/** Render one executed check's evidence: the exit fact, then the bounded output tails. */
function evidenceOf(result: ShellRunResult, maxChars: number): string {
  return bound([exitLine(result), ...outputLines(result)].join('\n'), maxChars)
}

/** How the candidate ended one case, as the directive clusters it. */
function exitClassOf(result: ShellRunResult): CaseExitClass {
  if (result.timedOut) return 'timeout'
  if (result.exitCode === null) return 'signal'
  return result.exitCode === 0 ? 'zero' : 'nonzero'
}

/** How each exit class reads in a cluster line. */
const EXIT_PHRASE: Readonly<Record<CaseExitClass, string>> = {
  zero: 'the program exited 0',
  nonzero: 'the program exited non-zero',
  signal: 'the program was terminated by a signal',
  timeout: 'the program exceeded the case timeout',
}

/** One executed case that did not match, with the command output only the log keeps. */
interface CaseFailure {
  readonly id: FailedCheckCase['id']
  readonly weight: number
  readonly channels: readonly CheckCaseChannel[]
  readonly exitClass: CaseExitClass
  readonly result: ShellRunResult
}

/** One check executed case by case: its tally and the failures behind it. */
interface CasedCheckRun {
  readonly passed: number
  readonly total: number
  readonly weightPassed: number
  readonly weightTotal: number
  readonly failures: readonly CaseFailure[]
}

/** Render one cased check's evidence: the tally, then each named failed case with its captured output. */
function casedEvidenceOf(run: CasedCheckRun, named: readonly CaseFailure[], maxChars: number): string {
  const lines = [`cases: ${run.passed} of ${run.total} passed (weight ${run.weightPassed} of ${run.weightTotal})`]
  for (const failure of named) {
    lines.push(`case "${failure.id}" differed on ${failure.channels.join(', ')}; ${exitLine(failure.result)}`)
    lines.push(...outputLines(failure.result))
  }
  return bound(lines.join('\n'), maxChars)
}

/**
 * Whether one captured stream disagrees with its expected digest. A truncated
 * stream disagrees whatever it holds: the executor dropped bytes the digest
 * covers, so the comparison cannot be made.
 */
function streamMismatch(
  stream: ShellRunResult['stdout'],
  expected: string | undefined,
  normalizers: readonly CheckCaseNormalizer[],
): boolean {
  return stream.truncated || caseChannelDigest(Buffer.from(stream.text, 'utf8'), normalizers) !== expected
}

/**
 * The configured channels of one case whose observed value disagrees with the
 * case's expected digest, in the canonical channel order the log records.
 * @param body - the case that ran.
 * @param result - what the candidate produced.
 * @param scope - the absolute `treeScope` directory, absent for a check that declares none.
 * @returns the mismatching channels; empty when the case passed.
 */
async function caseMismatches(
  body: CheckCase,
  result: ShellRunResult,
  scope: string | undefined,
): Promise<CheckCaseChannel[]> {
  const { normalizers } = body.comparator
  const mismatched = new Set<CheckCaseChannel>()
  for (const channel of body.comparator.channels) {
    switch (channel) {
      case 'exit':
        if (result.exitCode !== body.expected.exitCode) mismatched.add(channel)
        break
      case 'stdout':
        if (streamMismatch(result.stdout, body.expected.stdoutSha256, normalizers)) mismatched.add(channel)
        break
      case 'stderr':
        if (streamMismatch(result.stderr, body.expected.stderrSha256, normalizers)) mismatched.add(channel)
        break
      case 'tree':
        // Authoring requires a treeScope for every check whose cases compare the tree.
        if (await hashDirectory(scope as string, normalizers) !== body.expected.treeSha256) mismatched.add(channel)
        break
      /* v8 ignore next 2 -- CheckCaseChannel is closed and every member is handled above */
      default:
        return assertNever(channel)
    }
  }
  return CHECK_CASE_CHANNELS.filter(channel => mismatched.has(channel))
}

/** One rendered cluster with the check facts its line names. */
interface RenderedCluster extends DirectiveCluster {
  readonly outcome: string
  readonly total: number
  readonly weightTotal: number
  readonly exitClass: CaseExitClass
}

/** Group one cased check's failed cases by the channels that disagreed and how the candidate ended. */
function clustersOf(check: StandardCheck, result: CheckResult): RenderedCluster[] {
  const cases = result.cases
  /* v8 ignore next -- only a cased result reaches here, and a cased result carries its tally */
  if (cases === undefined) return []
  const clusters = new Map<string, RenderedCluster>()
  for (const failed of cases.failed) {
    const key = `${failed.exitClass}|${failed.channels.join(',')}`
    const existing = clusters.get(key)
    clusters.set(key, {
      checkId: result.checkId,
      channels: failed.channels,
      count: (existing?.count ?? 0) + 1,
      weight: (existing?.weight ?? 0) + failed.weight,
      outcome: check.outcome,
      total: cases.total,
      weightTotal: cases.weightTotal,
      exitClass: failed.exitClass,
    })
  }
  return [...clusters.values()]
}

/**
 * One directive per failed run. A cased check contributes one line per failure
 * cluster, naming its authored outcome, the cluster's count and weight, the
 * channels that disagreed, and how the candidate ended — never a case body, an
 * expected digest, or a byte of captured output. A check without cases
 * contributes its recorded evidence line.
 * @param failures - the run's failing results, in check order.
 * @param checks - the standard's active checks, supplying each outcome text.
 * @param maxChars - bound of the rendered detail.
 * @returns the directive, carrying `clusters` when a cased check failed.
 */
function describeFailures(
  failures: readonly CheckResult[],
  checks: readonly StandardCheck[],
  maxChars: number,
): DirectiveRequest {
  const lines: string[] = []
  const clusters: DirectiveCluster[] = []
  for (const failure of failures) {
    const check = checks.find(candidate => candidate.id === failure.checkId)
    if (check === undefined || failure.cases === undefined) {
      lines.push(failure.evidence)
      continue
    }
    for (const cluster of clustersOf(check, failure)) {
      clusters.push({ checkId: cluster.checkId, channels: cluster.channels, count: cluster.count, weight: cluster.weight })
      lines.push(`${cluster.outcome}: ${cluster.count} of ${cluster.total} cases failed (weight ${cluster.weight} of ${cluster.weightTotal}); mismatching channels: ${cluster.channels.join(', ')}; ${EXIT_PHRASE[cluster.exitClass]}`)
    }
  }
  return {
    rootCause: `${failures.length} of the standard's checks failed`,
    detail: bound(lines.map((line, index) => `${index + 1}. ${line}`).join('\n'), maxChars),
    ...clusters.length === 0 ? {} : { clusters },
  }
}

/**
 * The one directive a tampered attempt issues. A digest comparison knows that
 * the check-owned set changed and nothing else, so the text names neither a
 * path nor a check: it states that the measurement is void and that the run is
 * over. Pinned verbatim by the runner README and the `read-barrier-tamper`
 * snapshot.
 */
const TAMPER_DIRECTIVE: DirectiveRequest = {
  rootCause: 'the files this task is measured with were modified during the attempt',
  detail: 'Those files belong to the validator: the task is to make them pass, never to change them. This run is void and no certificate can follow it.',
}

/** The evidence every check of a tampered attempt records, since none of them ran. */
const TAMPER_EVIDENCE = 'not executed: the files this task is measured with were modified during the attempt'

/** The validator's follow-up turn after a failed run; the text is pinned by the runner README and its e2e. */
function followupText(directive: DirectiveRequest): string {
  return `<validation_failed>\n${directive.rootCause}\n${directive.detail}\nContinue working on the task; the validator runs again when you stop.\n</validation_failed>`
}

/** The sampling one run pins on its agent, absent when the run pins neither scalar. */
function pinnedSampling(seed: number | undefined, topP: number | undefined): AgentSampling | undefined {
  if (seed === undefined && topP === undefined) return undefined
  return {
    ...seed === undefined ? {} : { seed },
    ...topP === undefined ? {} : { topP },
  }
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
    maxFailedCases: z.natural().min(1).default(20),
    topP: z.number().min(0).max(1),
  })

  private readonly resolved: ResolvedConfig

  constructor(ctx: Context, config: Config) {
    super(ctx, 'environmentRuns')
    this.resolved = resolveConfig(config)
  }

  /**
   * Run one environment as one fresh session and validate it.
   * @param request - environment id, absolute workspace directory, optional
   *   model route, repetition, group, district, policy version, sampling seed, and abort signal.
   * @returns the stamp, the attempts, the certificate when one run passed, and the accumulated usage.
   * @throws {@link EnvironmentRunError} for an unknown environment, a seed that
   *   is not a safe non-negative integer, an unusable workspace or fixture, an
   *   implementer that replaced the goal, or a lost standard.
   */
  async run(request: EnvironmentRunRequest): Promise<EnvironmentRunReport> {
    const definition = this.ctx.environments.get(request.environment)
    if (definition === undefined) {
      throw new EnvironmentRunError(`environment "${request.environment}" is not registered`, 'ENVIRONMENT_RUN_UNKNOWN_ENVIRONMENT')
    }
    if (request.seed !== undefined && !isSeed(request.seed)) {
      throw new EnvironmentRunError(`seed must be a non-negative integer, got ${String(request.seed)}`, 'ENVIRONMENT_RUN_INVALID_SEED')
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
      ...request.district === undefined ? {} : { district: request.district },
      ...request.policyVersion === undefined ? {} : { policyVersion: request.policyVersion },
      ...request.seed === undefined ? {} : { seed: request.seed },
      model,
      isolation: this.resolved.isolation,
    }
    // The seed is per cell and topP is the deployment's; both are pinned for
    // the whole session, so every request of the run samples identically and
    // the logged request header states what was asked for. A run that pins
    // neither leaves the composition's own sampling alone.
    const sampling = pinnedSampling(request.seed, this.resolved.topP)
    const handle = await this.ctx.agents.create({
      sessionId: SessionId(`environment-${randomUUID()}`),
      meta: { cwd: request.workspace },
      agentOptions: { provider: model.provider, model: model.model },
      ...request.signal === undefined ? {} : { signal: request.signal },
      setup: (agentCtx) => {
        installModelSelection(agentCtx, {
          current: { provider: model.provider, model: model.model },
          assembled: undefined,
          ...sampling === undefined ? {} : { sampling },
        })
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
    const runDirectory = await this.reserve(agent, definition)
    agent.session.append('environment/run', stamp)
    const goal = goals.create(agent, {
      objective: definition.task.prompt,
      ...this.resolved.maxGoalRounds === undefined ? {} : { maxGoalRounds: this.resolved.maxGoalRounds },
    })
    goals.disarm(agent)
    const authored = completionStandards.author(agent, { goalId: goal.id, checks: definition.checks })
    // Authorship validated every case against the reference it carries and kept
    // the reference alone; the bodies stay here, for the reservation and the
    // per-case execution.
    const bodies = new Map(definition.checks.flatMap(check => (
      check.caseBodies === undefined ? [] : [[check.id, check.caseBodies] as const]
    )))
    const immutable = definition.task.immutable ?? []
    // Stock the reservation and digest the check-owned set before the
    // implementer's first turn: that digest is what every later attempt is
    // compared against.
    await materializeChecks(runDirectory, authored, bodies)
    let checkOwned = await hashCheckOwned(request.workspace, runDirectory, immutable)
    const attempts: EnvironmentRunAttempt[] = []
    let certificate: VerificationCertificate | undefined
    let prompt = definition.task.prompt
    try {
      for (let attempt = 1; attempt <= this.resolved.maxAttempts; attempt += 1) {
        await this.deliver(agent, prompt)
        const standard = this.currentStandard(agent, goal.id)
        const ref = { id: standard.id, revision: standard.revision }
        if (await hashCheckOwned(request.workspace, runDirectory, immutable) !== checkOwned) {
          attempts.push(await this.recordTamper(agent, standard, ref, request.workspace, attempt))
          break
        }
        const treeHash = await restoreFixture(request.workspace, definition.task.fixture)
        const scripts = await materializeChecks(runDirectory, standard, bodies)
        // The validator just rewrote its own directory, so the set it now owns
        // is the baseline the next attempt must still find.
        checkOwned = await hashCheckOwned(request.workspace, runDirectory, immutable)
        const results = await this.execute(standard.checks, request, scripts, bodies)
        const outcome = completionStandards.recordRun(agent, ref, this.resolved.isolation, results, {
          executor: 'runner',
          treeHash,
        })
        attempts.push({ attempt, results, treeHash })
        if (outcome.certified) {
          certificate = outcome.certificate
          const current = goals.get(agent)
          if (current === undefined || current.id !== goal.id) {
            throw new EnvironmentRunError(`the implementer replaced goal "${goal.id}"`, 'ENVIRONMENT_RUN_GOAL_REPLACED')
          }
          goals.complete(agent, { id: current.id, revision: current.revision })
          break
        }
        const directive = describeFailures(outcome.failures, standard.checks, this.resolved.evidenceMaxChars)
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

  /** Send one user turn to the implementer and wait for the whole agent to go idle. */
  private async deliver(agent: Agent, text: string): Promise<void> {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }

  /**
   * Record one attempt whose check-owned set changed under the validator. The
   * checks are not executed — the workspace no longer measures the task — so
   * every result records that, the run is recorded as `tampered` and certifies
   * nothing, and the implementer receives the tamper directive as its last
   * validation follow-up before the attempt loop ends.
   * @param agent - the implementer whose attempt this is.
   * @param standard - the standard the attempt would have measured.
   * @param ref - that standard's exact revision.
   * @param workspace - the run's workspace, digested as the attempt left it.
   * @param attempt - one-based attempt number.
   * @returns the attempt the report carries.
   */
  private async recordTamper(
    agent: Agent,
    standard: StandardView,
    ref: StandardRef,
    workspace: string,
    attempt: number,
  ): Promise<EnvironmentRunAttempt> {
    const results: CheckResult[] = standard.checks.map(check => ({
      checkId: check.id,
      status: 'fail',
      evidence: bound(TAMPER_EVIDENCE, this.resolved.evidenceMaxChars),
    }))
    const treeHash = await hashDirectory(workspace)
    this.ctx.completionStandards.recordRun(agent, ref, this.resolved.isolation, results, {
      executor: 'runner',
      treeHash,
      tampered: true,
    })
    this.ctx.completionStandards.issueDirective(agent, ref, TAMPER_DIRECTIVE)
    await this.deliver(agent, followupText(TAMPER_DIRECTIVE))
    return { attempt, results, treeHash }
  }

  /** The standard the run measures; the implementer cannot mutate it, so another goal's standard or none is an anomaly. */
  private currentStandard(agent: Agent, goalId: GoalId): StandardView {
    const standard = this.ctx.completionStandards.get(agent)
    if (standard === undefined || standard.goalId !== goalId) {
      throw new EnvironmentRunError(`the standard for goal "${goalId}" is no longer current`, 'ENVIRONMENT_RUN_STANDARD_LOST')
    }
    return standard
  }

  /**
   * Reserve the run's validator-owned directory and stock what the checks read
   * from it. Without a composed barrier there is no reservation and the checks
   * run their instructions inline, exactly as the run's declared isolation says.
   * @param agent - the implementer agent this run drives.
   * @param definition - the environment being run, supplying the held-out fixture.
   * @returns the reservation, or `undefined` when no barrier is composed.
   */
  private async reserve(agent: Agent, definition: EnvironmentDefinition): Promise<string | undefined> {
    const barrier = this.ctx.get('readBarrier')
    if (barrier === undefined) return undefined
    const runDirectory = barrier.reserve(agent)
    // A held-out environment's fixture is evaluation material: the copy under
    // the reservation is the one an inspecting validator reads, never the
    // workspace overlay the implementer works in.
    if (definition.heldOut && definition.task.fixture !== undefined) {
      await cp(definition.task.fixture, join(runDirectory, FIXTURE_DIR), { recursive: true })
    }
    return runDirectory
  }

  /**
   * Run every active check in order through the shell executor rooted at the
   * workspace. A reserved check runs its script; an unreserved one runs its
   * instruction inline. A check that carries cases runs once per case and its
   * verdict follows the cases; every other check's verdict is its exit code.
   */
  private async execute(
    checks: readonly StandardCheck[],
    request: EnvironmentRunRequest,
    scripts: ReadonlyMap<string, string>,
    bodies: ReadonlyMap<string, readonly CheckCase[]>,
  ): Promise<CheckResult[]> {
    const results: CheckResult[] = []
    for (const check of checks) {
      const script = scripts.get(check.id)
      const command = script === undefined ? check.run : `. ${script}`
      const cases = bodies.get(check.id)
      if (cases === undefined) {
        const result = await this.ctx.shell.run(this.caseSpec(command, request))
        results.push({
          checkId: check.id,
          status: passed(result) ? 'pass' : 'fail',
          evidence: evidenceOf(result, this.resolved.evidenceMaxChars),
        })
        continue
      }
      const run = await this.executeCases(check, cases, command, request)
      // One bounded list of named failures serves both the durable tally and
      // the evidence, so a run of hundreds of cases names the same subset twice.
      const named = run.failures.slice(0, this.resolved.maxFailedCases)
      results.push({
        checkId: check.id,
        status: run.passed === run.total ? 'pass' : 'fail',
        evidence: casedEvidenceOf(run, named, this.resolved.evidenceMaxChars),
        cases: {
          passed: run.passed,
          total: run.total,
          weightPassed: run.weightPassed,
          weightTotal: run.weightTotal,
          failed: named.map(failure => ({
            id: failure.id,
            weight: failure.weight,
            channels: failure.channels,
            exitClass: failure.exitClass,
          })),
        },
      })
    }
    return results
  }

  /** Resolve one check or case command against the workspace and the run's cancellation. */
  private caseSpec(command: string, request: EnvironmentRunRequest, stdin?: string): ShellExecSpec {
    return this.ctx.shell.resolve({
      command,
      workdir: request.workspace,
      timeoutMs: this.resolved.checkTimeoutMs,
      signal: request.signal,
      ...stdin === undefined ? {} : { stdin },
    })
  }

  /**
   * Run one cased check case by case: empty the check's `treeScope`, stage the
   * case's files, append its `argv` to the check's command, feed its `stdin`,
   * then compare every configured channel against the case's digest.
   */
  private async executeCases(
    check: StandardCheck,
    cases: readonly CheckCase[],
    command: string,
    request: EnvironmentRunRequest,
  ): Promise<CasedCheckRun> {
    const failures: CaseFailure[] = []
    let passedCases = 0
    let weightPassed = 0
    for (const body of cases) {
      const scope = check.treeScope === undefined ? undefined : join(request.workspace, check.treeScope)
      if (scope !== undefined) {
        await rm(scope, { recursive: true, force: true })
        await mkdir(scope, { recursive: true })
      }
      for (const [path, content] of Object.entries(body.input.files ?? {})) {
        const staged = join(request.workspace, path)
        await mkdir(dirname(staged), { recursive: true })
        await writeFile(staged, content)
      }
      const result = await this.ctx.shell.run(
        this.caseSpec([command, ...body.input.argv].join(' '), request, body.input.stdin),
      )
      const channels = await caseMismatches(body, result, scope)
      if (channels.length === 0) {
        passedCases += 1
        weightPassed += body.weight
        continue
      }
      failures.push({ id: body.id, weight: body.weight, channels, exitClass: exitClassOf(result), result })
    }
    return {
      passed: passedCases,
      total: cases.length,
      weightPassed,
      weightTotal: cases.reduce((sum, body) => sum + body.weight, 0),
      failures,
    }
  }
}

export default EnvironmentRunner
