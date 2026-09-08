/**
 * Environment runner: the automated validator that runs one registered
 * environment as one fresh session. It stamps the session with the
 * environment it runs, authors the completion standard from the environment's
 * checks, denies the cell everything above its own workspace for the length of
 * the run, has each attempt implemented either by the session's own model route
 * or by an out-of-band coding agent started through the subagent seam, moves
 * each attempt to its own rung of the request's attempt ladder, restores
 * the fixture's immutable paths and executes the checks through the shell
 * executor after each attempt, records the run, and completes the goal only
 * under a certificate. The
 * [environment-runner](../../../.agents/notes/proposed/architecture/2026-09-05-environment-runner.md),
 * [external-implementer](../../../.agents/notes/proposed/architecture/2026-09-06-external-implementer.md),
 * and [attempt-ladder](../../../.agents/notes/proposed/architecture/2026-09-08-attempt-ladder.md)
 * Agent Notes own the design rationale.
 * @module @deepseek-ai/dsh-environment-runner
 */

import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentSampling, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
// Also resolves the `usage/foreign` SessionEventMap merge the delegated caps write through.
import type { BudgetCap, SessionBudgets } from '@deepseek-ai/dsh-budget-policy'
import { ENVIRONMENT_RUN_VERSION, environmentContentHashes, isSeed, ROUTE_IMPLEMENTER } from '@deepseek-ai/dsh-environments'
import type {
  EnvironmentDefinition,
  EnvironmentId,
  EnvironmentRunModel,
  EnvironmentRunStamp,
  EnvironmentTask,
} from '@deepseek-ai/dsh-environments/types'
import type {} from '@deepseek-ai/dsh-goal'
import type { GoalId } from '@deepseek-ai/dsh-goal/types'
import { assertNever, createUserMessage, HarnessError } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-read-barrier'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ShellExecSpec, ShellRunResult } from '@deepseek-ai/dsh-shell'
import { runsOutOfProcess } from '@deepseek-ai/dsh-subagent'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { caseChannelDigest, CHECK_CASE_CHANNELS, hashWorkspaceTree } from '@deepseek-ai/dsh-verification'
import type {
  CaseExitClass,
  CertificateIsolation,
  CheckCase,
  CheckCaseChannel,
  CheckCaseComparator,
  CheckCaseExpectation,
  CheckCaseInput,
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
import type {
  EnvironmentRunAttempt,
  EnvironmentRunImplementer,
  EnvironmentRunReport,
  EnvironmentRunRequest,
  EnvironmentRunRung,
  EnvironmentRunTranscript,
} from './types.ts'

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
  | 'ENVIRONMENT_RUN_INVALID_LADDER'
  | 'ENVIRONMENT_RUN_INVALID_WORKSPACE'
  | 'ENVIRONMENT_RUN_INVALID_FIXTURE'
  | 'ENVIRONMENT_RUN_UNSAFE_CHECK_SCRIPT'
  | 'ENVIRONMENT_RUN_GOAL_REPLACED'
  | 'ENVIRONMENT_RUN_STANDARD_LOST'
  | 'ENVIRONMENT_RUN_NO_REFERENCE'
  | 'ENVIRONMENT_RUN_NO_RESERVATION'
  | 'ENVIRONMENT_RUN_IMPLEMENTER_UNAVAILABLE'
  | 'ENVIRONMENT_RUN_IMPLEMENTER_UNCONFINED'
  | 'ENVIRONMENT_RUN_IMPLEMENTER_MODEL_UNSUPPORTED'
  | 'ENVIRONMENT_RUN_IMPLEMENTER_UNBOUNDED'

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
  /**
   * Rungs one request's attempt ladder may name. A ladder is the attempt bound
   * of the run that carries it, so an unbounded ladder in a plan file would be
   * an unbounded run; this is the ceiling a deployment lets a plan reach.
   */
  maxLadderRungs?: number
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
  readonly maxLadderRungs: number
  readonly maxGoalRounds: number | undefined
  readonly checkTimeoutMs: number | undefined
  readonly evidenceMaxChars: number
  readonly maxFailedCases: number
  readonly topP: number | undefined
}

/**
 * Rungs a ladder may reach where the deployment states no ceiling. The routing
 * arms of the hypothesis program ladder three models, and the longest arm this
 * runner has a consumer for is a repeated-attempt one; eight leaves that room
 * without letting a plan file mint an arbitrarily long run.
 */
const DEFAULT_MAX_LADDER_RUNGS = 8

/**
 * Apply the runner's defaults to a validated config.
 * @param config - validated deployment config.
 * @returns the resolved choices: one attempt, eight ladder rungs, 2000 evidence characters, and 20 listed failed cases unless configured.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  return {
    isolation: config.isolation,
    maxAttempts: config.maxAttempts ?? 1,
    maxLadderRungs: config.maxLadderRungs ?? DEFAULT_MAX_LADDER_RUNGS,
    maxGoalRounds: config.maxGoalRounds,
    checkTimeoutMs: config.checkTimeoutMs,
    evidenceMaxChars: config.evidenceMaxChars ?? 2000,
    maxFailedCases: config.maxFailedCases ?? 20,
    topP: config.topP,
  }
}

/**
 * Apply the request's implementer default.
 * @param request - the run request as its caller wrote it.
 * @returns the implementer of every attempt: the session's own model route unless the request named a subagent provider.
 */
export function resolveImplementer(request: EnvironmentRunRequest): EnvironmentRunImplementer {
  return request.implementer ?? { kind: 'route' }
}

/**
 * The name one implementer is stamped and folded under.
 * @param implementer - the resolved implementer.
 * @returns {@link ROUTE_IMPLEMENTER} for the session's own route, else the provider name.
 */
export function implementerName(implementer: EnvironmentRunImplementer): string {
  switch (implementer.kind) {
    case 'route':
      return ROUTE_IMPLEMENTER
    case 'subagent':
      return implementer.provider
    /* v8 ignore next 2 -- EnvironmentRunImplementer is closed and every member is handled above */
    default:
      return assertNever(implementer, 'run implementer')
  }
}

/**
 * What one implementer carries from an attempt into the next one. It is a
 * property of the instrument rather than of the attempt: a route implementer
 * works in the cell session, which every later attempt continues, and a
 * subagent implementer starts one fresh child per attempt.
 * @param implementer - the resolved implementer.
 * @returns `kept` for the session's own route, `dropped` for a delegated run.
 */
export function implementerTranscript(implementer: EnvironmentRunImplementer): EnvironmentRunTranscript {
  switch (implementer.kind) {
    case 'route':
      return 'kept'
    case 'subagent':
      return 'dropped'
    /* v8 ignore next 2 -- EnvironmentRunImplementer is closed and every member is handled above */
    default:
      return assertNever(implementer, 'run implementer')
  }
}

/**
 * Resolve one request's attempt ladder against the run's stamped model: the
 * concrete route of each attempt, in attempt order. It is the run's attempt
 * bound as well as its routing, so an empty ladder would be a run with no
 * attempt and a ladder past the deployment's ceiling a run the deployment never
 * allowed; both are refused here, before any agent exists.
 * @param ladder - the rungs the request named, absent for a run without one.
 * @param model - the run's stamped route, which a rung naming no model runs on.
 * @param maxRungs - rungs this deployment lets one ladder reach.
 * @returns one model route per attempt, or `undefined` for a request that named no ladder.
 * @throws {@link EnvironmentRunError} for an empty ladder and for one past the ceiling.
 */
export function resolveLadder(
  ladder: readonly EnvironmentRunRung[] | undefined,
  model: EnvironmentRunModel,
  maxRungs: number,
): readonly EnvironmentRunModel[] | undefined {
  if (ladder === undefined) return undefined
  if (ladder.length === 0) {
    throw new EnvironmentRunError('an attempt ladder must name at least one rung', 'ENVIRONMENT_RUN_INVALID_LADDER')
  }
  if (ladder.length > maxRungs) {
    throw new EnvironmentRunError(`an attempt ladder of ${ladder.length} rungs exceeds the configured ceiling of ${maxRungs}`, 'ENVIRONMENT_RUN_INVALID_LADDER')
  }
  return ladder.map(rung => rung.model ?? model)
}

/** One run's implementer with the services a delegated one needs already resolved. */
type RunImplementer =
  | { readonly kind: 'route' }
  | {
    readonly kind: 'subagent'
    readonly provider: string
    readonly label?: string
    readonly subagents: SubagentRuntime
    /** The budget policy whose caps bound every attempt this implementer runs. */
    readonly budgets: SessionBudgets
  }

/** What one attempt hands its implementer, whichever implementer that is. */
interface AttemptDelivery {
  /** One-based attempt number. */
  readonly attempt: number
  /** The text the implementer receives: the task statement, the validation follow-up, or both. */
  readonly text: string
  /** Whether {@link text} restated the task ahead of a validation directive. */
  readonly restatedTask: boolean
  /** The attempt's ladder rung, which is the run's stamped model where it named no ladder. */
  readonly model: EnvironmentRunModel
  /** Cancellation of the enclosing run. */
  readonly signal?: AbortSignal
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

/**
 * Reservation subdirectory holding the reference program of an environment
 * that declares `task.reference`. It sits inside the reservation, so the
 * check-owned digest already covers it and an implementer is denied it by the
 * same rule that denies the check scripts beside it.
 */
export const REFERENCE_DIR = 'reference'

/**
 * File inside {@link REFERENCE_DIR} the validator's instrument sources to run
 * the reference, mirroring the `run` file of a reserved check. A fixed name
 * rather than a configured one: it is the convention an environment author and
 * the instrument agree on, not a deployment choice.
 */
export const REFERENCE_ENTRY = 'run'

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
  if (await isDirectory(path)) return hashWorkspaceTree(path)
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
    hash.update(RESERVATION_KEY).update('\0').update(await hashWorkspaceTree(runDirectory)).update('\0')
  }
  for (const path of immutable) {
    hash.update(path).update('\0').update(await hashCheckOwnedPath(join(workspace, path))).update('\0')
  }
  return hash.digest('hex')
}

/**
 * Copy the task's reference tree beneath one reservation, so the validator
 * runs the reference from a directory the barrier denies every implementer.
 * @param task - the task, supplying the fixture and its reference directory.
 * @param runDirectory - the reservation to stock.
 */
async function copyReference(task: EnvironmentTask, runDirectory: string): Promise<void> {
  // A registered reference always resolves inside its task's fixture.
  if (task.reference === undefined) return
  await cp(join(task.fixture as string, task.reference), join(runDirectory, REFERENCE_DIR), { recursive: true })
}

/**
 * Overlay the task fixture and drop the reference tree from the copy. The
 * reference belongs to the validator: it lives under the fixture so the
 * environment's content hashes cover it, and it is removed here so no overlay
 * ever leaves it where the implementer works.
 * @param workspace - the run's workspace directory.
 * @param fixture - the task's fixture directory.
 * @param reference - the task's fixture-relative reference directory, if any.
 */
async function overlayFixture(workspace: string, fixture: string, reference: string | undefined): Promise<void> {
  await cp(fixture, workspace, { recursive: true })
  if (reference !== undefined) await rm(join(workspace, reference), { recursive: true, force: true })
}

/** Whether a path exists at all, whatever its kind. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    // stat rejects only with filesystem access errors (ENOENT/EACCES/ENOTDIR),
    // each of which means the fixture does not supply the path.
    return false
  }
}

/**
 * Reject a workspace or fixture that is not an existing absolute directory, an
 * immutable path the fixture does not supply, and an immutable path that names
 * the reference or lies inside it (the restoration before each validation
 * would carry the reference into the implementer's tree), then overlay the
 * fixture and return its digest.
 * @returns the fixture digest, or `undefined` for a task without a fixture.
 */
async function prepareWorkspace(workspace: string, task: EnvironmentTask): Promise<string | undefined> {
  if (!isAbsolute(workspace) || !await isDirectory(workspace)) {
    throw new EnvironmentRunError(`workspace "${workspace}" is not an existing absolute directory`, 'ENVIRONMENT_RUN_INVALID_WORKSPACE')
  }
  const fixture = task.fixture
  if (fixture === undefined) return undefined
  if (!isAbsolute(fixture) || !await isDirectory(fixture)) {
    throw new EnvironmentRunError(`fixture "${fixture}" is not an existing absolute directory`, 'ENVIRONMENT_RUN_INVALID_FIXTURE')
  }
  for (const path of task.immutable ?? []) {
    if (task.reference !== undefined && (path === task.reference || path.startsWith(`${task.reference}/`))) {
      throw new EnvironmentRunError(`immutable path "${path}" names the reference, which never reaches the workspace`, 'ENVIRONMENT_RUN_INVALID_FIXTURE')
    }
    if (!await exists(join(fixture, path))) {
      throw new EnvironmentRunError(`fixture "${fixture}" does not supply the immutable path "${path}"`, 'ENVIRONMENT_RUN_INVALID_FIXTURE')
    }
  }
  await overlayFixture(workspace, fixture, task.reference)
  return hashWorkspaceTree(fixture)
}

/**
 * Copy the environment's immutable paths from the fixture again, so an
 * implementer edit to a validator-owned file never reaches the checks, and
 * leave every other file as the implementer left it: a task that asks for a
 * change to a fixture-supplied source file is satisfiable only that way. Then
 * digest the workspace the validation will read.
 * @param workspace - the run's workspace directory.
 * @param task - the task, supplying the fixture and its immutable paths.
 * @returns the workspace digest as the validation begins.
 */
async function restoreFixture(workspace: string, task: EnvironmentTask): Promise<string> {
  if (task.fixture !== undefined) {
    for (const path of task.immutable ?? []) {
      await cp(join(task.fixture, path), join(workspace, path), { recursive: true })
    }
  }
  return hashWorkspaceTree(workspace)
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
    const cases = bodies.get(check.id)
    // A cased check is sourced once per case with that case's argv as the
    // script's positional parameters, so the script forwards them; a caseless
    // check's command is complete as written and is sourced with none.
    await writeFile(script, cases === undefined ? `${check.run}\n` : `${check.run} "$@"\n`, { mode: 0o600 })
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
        if (await hashWorkspaceTree(scope as string, normalizers) !== body.expected.treeSha256) mismatched.add(channel)
        break
      /* v8 ignore next 2 -- CheckCaseChannel is closed and every member is handled above */
      default:
        return assertNever(channel)
    }
  }
  return CHECK_CASE_CHANNELS.filter(channel => mismatched.has(channel))
}

/** How one case's command is resolved before it runs, shared by every executor of a case. */
export interface CaseExecution {
  /** Absolute directory the case runs in and stages its files under. */
  readonly workspace: string
  /** Command the case's `argv` words are appended to. */
  readonly command: string
  /** What the case feeds the candidate or the reference. */
  readonly input: CheckCaseInput
  /** Normalized workspace-relative directory the `tree` channel digests, absent for a case that compares none. */
  readonly treeScope?: string
  /** Per-case timeout handed to the executor, absent to apply the executor default. */
  readonly timeoutMs?: number
  /** Cancellation of the enclosing run. */
  readonly signal?: AbortSignal
}

/** What one executed case left behind on the four comparable channels. */
export interface CaseCapture {
  /** Exit, signal, timeout, and the captured `stdout` and `stderr` of the command. */
  readonly result: ShellRunResult
  /** Absolute `treeScope` directory as the case left it, absent for a case that compares no tree. */
  readonly scope?: string
}

/**
 * Run one case and capture all four channels: empty the case's `treeScope`,
 * stage its files, append its `argv` to the command, and feed its `stdin`.
 * Both executors of a case go through here — the runner measuring a candidate
 * and the instrument recording a reference — so what a case means is one
 * procedure rather than two that can drift.
 * @param shell - the composed shell executor.
 * @param execution - the resolved command, workspace, input, and bounds.
 * @returns the command's result and the tree scope it left.
 */
export async function captureCase(shell: Context['shell'], execution: CaseExecution): Promise<CaseCapture> {
  const scope = execution.treeScope === undefined ? undefined : join(execution.workspace, execution.treeScope)
  if (scope !== undefined) {
    await rm(scope, { recursive: true, force: true })
    await mkdir(scope, { recursive: true })
  }
  for (const [path, content] of Object.entries(execution.input.files ?? {})) {
    const staged = join(execution.workspace, path)
    await mkdir(dirname(staged), { recursive: true })
    await writeFile(staged, content)
  }
  const stdin = execution.input.stdin
  const result = await shell.run(shell.resolve({
    command: [execution.command, ...execution.input.argv].join(' '),
    workdir: execution.workspace,
    timeoutMs: execution.timeoutMs,
    signal: execution.signal,
    ...stdin === undefined ? {} : { stdin },
  }))
  return { result, ...scope === undefined ? {} : { scope } }
}

/**
 * The expected digests one capture establishes for a comparator's configured
 * channels, which is what {@link caseMismatches} later compares a candidate
 * against. A truncated compared stream yields no digest for that channel: the
 * executor dropped bytes the digest would cover, so nothing could ever match it.
 * @param capture - what the reference produced for the case.
 * @param comparator - the channels compared and the normalizers applied first.
 * @returns the expectation, holding one value per configured channel that could be digested.
 */
export async function caseExpectation(
  capture: CaseCapture,
  comparator: CheckCaseComparator,
): Promise<CheckCaseExpectation> {
  const { normalizers } = comparator
  const { result } = capture
  const digest = (stream: ShellRunResult['stdout']): Record<string, never> | { sha256: string } => (
    stream.truncated ? {} : { sha256: caseChannelDigest(Buffer.from(stream.text, 'utf8'), normalizers) }
  )
  let expectation: CheckCaseExpectation = {}
  for (const channel of comparator.channels) {
    switch (channel) {
      case 'exit':
        expectation = { ...expectation, ...result.exitCode === null ? {} : { exitCode: result.exitCode } }
        break
      case 'stdout': {
        const value = digest(result.stdout)
        expectation = { ...expectation, ...'sha256' in value ? { stdoutSha256: value.sha256 } : {} }
        break
      }
      case 'stderr': {
        const value = digest(result.stderr)
        expectation = { ...expectation, ...'sha256' in value ? { stderrSha256: value.sha256 } : {} }
        break
      }
      case 'tree':
        // Only a comparator naming `tree` reaches here, and such a case is
        // executed with the scope its check declares.
        expectation = { ...expectation, treeSha256: await hashWorkspaceTree(capture.scope as string, normalizers) }
        break
      /* v8 ignore next 2 -- CheckCaseChannel is closed and every member is handled above */
      default:
        return assertNever(channel)
    }
  }
  return expectation
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

/**
 * The whole text one attempt of a fresh child receives: the task statement
 * again, then the validator's follow-up. A child holds none of the earlier
 * attempts' transcript, so the follow-up alone would ask it to continue work it
 * has no statement of. Pinned by the runner README and its e2e.
 */
function restatedFollowupText(prompt: string, directive: DirectiveRequest): string {
  return `${prompt}\n\n${followupText(directive)}`
}

/**
 * The text one attempt hands its implementer, and whether that text restated
 * the task ahead of a validation directive. The first attempt of either
 * implementer receives the task statement alone. A later attempt receives what
 * its transcript interface leaves it needing: a route implementer continues the
 * session that already holds the task and the work, so the directive alone; a
 * delegated one starts a child that holds neither, so the task statement again
 * ahead of the directive. One decision answers both, because the record of what
 * a child was asked must not be able to disagree with what it was asked.
 * @param implementer - who does the work of this attempt.
 * @param prompt - the environment's task statement.
 * @param directive - the last failed validation's directive, absent on the first attempt.
 * @returns the text the implementer receives and whether it restated the task.
 */
function attemptText(
  implementer: RunImplementer,
  prompt: string,
  directive: DirectiveRequest | undefined,
): Pick<AttemptDelivery, 'text' | 'restatedTask'> {
  if (directive === undefined) return { text: prompt, restatedTask: false }
  switch (implementer.kind) {
    case 'route':
      return { text: followupText(directive), restatedTask: false }
    case 'subagent':
      return { text: restatedFollowupText(prompt, directive), restatedTask: true }
    /* v8 ignore next 2 -- RunImplementer is closed and every member is handled above */
    default:
      return assertNever(implementer, 'run implementer')
  }
}

/** The sampling one run pins on its agent, absent when the run pins neither scalar. */
function pinnedSampling(seed: number | undefined, topP: number | undefined): AgentSampling | undefined {
  if (seed === undefined && topP === undefined) return undefined
  return {
    ...seed === undefined ? {} : { seed },
    ...topP === undefined ? {} : { topP },
  }
}

/**
 * Milliseconds a delegated attempt is given past the wall budget it has left.
 * `maxWallMs` is exceeded only by a span strictly greater than it, so a deadline
 * armed exactly at the remaining budget could expire on a span that equals the
 * cap and records no breach. Fixed by that comparison, not a deployment choice.
 */
const DEADLINE_OVERSHOOT_MS = 1

/**
 * The cancellation one delegated attempt runs under: the run's own signal, plus
 * the wall budget its cell has left. One controller owns both, so a caller
 * reads `expired` to tell which of the two ended the attempt and disposes the
 * timer on every path.
 */
class DelegationDeadline {
  /** Cancellation to start the child under. */
  readonly signal: AbortSignal

  private readonly controller = new AbortController()
  private readonly timer: ReturnType<typeof setTimeout> | undefined
  private fired = false

  /**
   * @param remainingWallMs - wall budget the cell has left, absent when no wall cap applies.
   * @param signal - the run's own cancellation, absent for a run that carries none.
   */
  constructor(remainingWallMs: number | undefined, signal: AbortSignal | undefined) {
    this.timer = remainingWallMs === undefined ? undefined : setTimeout(() => {
      this.fired = true
      this.controller.abort()
    }, Math.max(remainingWallMs, 0) + DEADLINE_OVERSHOOT_MS)
    this.signal = signal === undefined ? this.controller.signal : AbortSignal.any([signal, this.controller.signal])
  }

  /** Whether the cell's wall budget, rather than the run's own signal, ended the attempt. */
  get expired(): boolean {
    return this.fired
  }

  /** Release the timer; safe to call more than once. */
  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
  }
}

/**
 * How one attempt ended, as the cell's budget decided.
 *
 * `blocked` is the delegated counterpart of the stopped step a route cell gets:
 * no implementer ran, so the workspace is exactly what the previous attempt's
 * validation already measured and the run ends without measuring it again.
 * `cut-short` ran an implementer the wall deadline then cancelled, so the tree
 * it left is validated before the run ends.
 */
type AttemptOutcome = 'ran' | 'cut-short' | 'blocked'

/**
 * Count the reads the barrier refused in one session log. It is the cell's own
 * record of leaving its workspace, so a scorekeeper that folds the log and a
 * caller that reads the report agree without a second source.
 * @param events - the cell session's log.
 * @returns the `read-barrier/denied` records it carries.
 */
function deniedReads(events: readonly SessionEvent[]): number {
  return events.filter(event => event.type === 'read-barrier/denied').length
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
    maxLadderRungs: z.natural().min(1).default(DEFAULT_MAX_LADDER_RUNGS),
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
   * Run the implementer refusals of {@link run} against one implementer and
   * stamped route, without running anything. A planner calls it while it is
   * still validating a plan, so a provider this composition cannot honor
   * refuses the plan instead of every cell of it: the refusals are the same
   * ones, raised from the same resolution, before the first workspace exists.
   * A route implementer is refused nothing, because the session's own model
   * route is what a run without an implementer already uses.
   * @param implementer - who would do the work of each attempt.
   * @param model - the route the runs would be stamped with, which is the first
   *   rung a child run is started on.
   * @throws {@link EnvironmentRunError} when the named provider is not composed,
   *   runs outside this process under an isolation above `none`, does not
   *   support the subagent seam's `model` capability, or has no budget policy to
   *   bound its attempts.
   */
  checkImplementer(implementer: EnvironmentRunImplementer, model: EnvironmentRunModel): void {
    this.requireImplementer(implementer, model)
  }

  /**
   * Run one environment as one fresh session and validate it.
   * @param request - environment id, absolute workspace directory, optional
   *   implementer, model route, attempt ladder, repetition, group, district,
   *   policy version, sampling seed, and abort signal.
   * @returns the stamp, the attempts with the route each ran on, the
   *   certificate when one run passed, the accumulated usage, and the caps the
   *   cell ran under.
   * @throws {@link EnvironmentRunError} for an unknown environment, a seed that
   *   is not a safe non-negative integer, an empty or over-long attempt ladder,
   *   an implementer provider the composition does not hold, cannot confine, or
   *   has no budget policy to bound, an unusable workspace or fixture, an
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
    const requested = resolveImplementer(request)
    const requestedModel = request.model ?? this.defaultModel()
    const ladder = resolveLadder(request.ladder, requestedModel, this.resolved.maxLadderRungs)
    // The stamp names the route the run STARTS on, so a laddered arm and an
    // unladdered one on the same first rung stay comparable at their first attempt.
    const model = ladder?.[0] ?? requestedModel
    const implementer = this.requireImplementer(requested, model)
    const fixtureSha256 = await prepareWorkspace(request.workspace, definition.task)
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
      ...ladder === undefined ? {} : { ladder },
      isolation: this.resolved.isolation,
      implementer: implementerName(requested),
    }
    // The seed is per cell and topP is the deployment's; both are pinned for
    // the whole session, so every request of the run samples identically and
    // the logged request header states what was asked for. A run that pins
    // neither leaves the composition's own sampling alone.
    const sampling = pinnedSampling(request.seed, this.resolved.topP)
    // The runner keeps the selection rather than installing and forgetting it:
    // a ladder moves the cell agent to the next rung's route between attempts,
    // which takes effect on the next step that enters prompt assembly.
    const selection: ModelSelectionRef = {
      current: { provider: model.provider, model: model.model },
      assembled: undefined,
      ...sampling === undefined ? {} : { sampling },
    }
    const handle = await this.ctx.agents.create({
      sessionId: SessionId(`environment-${randomUUID()}`),
      meta: { cwd: request.workspace },
      agentOptions: { provider: model.provider, model: model.model },
      ...request.signal === undefined ? {} : { signal: request.signal },
      setup: (agentCtx) => {
        installModelSelection(agentCtx, selection)
      },
    })
    const sealed = this.sealWorkspace(handle.agent, request.workspace)
    try {
      return await this.drive(handle.agent, definition, stamp, request, implementer, selection)
    } finally {
      sealed()
      await handle.dispose()
    }
  }

  /**
   * Deny this cell everything above its own workspace for as long as the run
   * lasts. The parent directory is what the denial names rather than each
   * sibling: it holds the run's plan and log as well as the other cells, so
   * listing it or reading one file in it leaks the experiment the cell is part
   * of. The barrier grants the session's own workspace beneath it, so the
   * denial reaches everything above the cell and nothing inside it.
   *
   * A composition without a barrier denies nothing, exactly as its `isolation`
   * claim says, and the registration is a disposer either way.
   * @param agent - the cell agent whose session the denial binds.
   * @param workspace - the run's workspace; its parent is the denied directory.
   * @returns the registration's disposer, a no-op without a composed barrier.
   */
  private sealWorkspace(agent: Agent, workspace: string): () => void {
    const barrier = this.ctx.get('readBarrier')
    if (barrier === undefined) return () => {}
    return barrier.denyFor(agent.session, dirname(workspace))
  }

  /** The composition's default model route, detached from the selection service. */
  private defaultModel(): EnvironmentRunModel {
    const selection = this.ctx.agentDefaultModel.currentSelection()
    return { provider: selection.provider, model: selection.model }
  }

  /**
   * Resolve the subagent runtime a delegated run starts its children on, before
   * any agent exists. A provider the composition does not hold, one whose child
   * this process cannot fence under a claim above `none`, and one that cannot
   * be told which model to run all fail here rather than at the first attempt,
   * when a stamped session would already exist for a run that can never
   * certify — or, for the model, would exist claiming an arm the child never
   * ran.
   * @param implementer - the implementer the request resolved to.
   * @param model - the run's stamped route, which is the first rung a child run is started on.
   * @returns the run implementer with its services resolved.
   * @throws {@link EnvironmentRunError} when the named provider is not composed,
   *   runs outside this process under an isolation above `none`, does not
   *   support the subagent seam's `model` capability, or has no budget policy to
   *   bound its attempts.
   */
  private requireImplementer(implementer: EnvironmentRunImplementer, model: EnvironmentRunModel): RunImplementer {
    if (implementer.kind === 'route') return implementer
    const { provider: name, label } = implementer
    const subagents = this.ctx.get('subagents')
    if (subagents === undefined) {
      throw new EnvironmentRunError(`implementer provider "${name}" is unavailable: this composition has no subagent service`, 'ENVIRONMENT_RUN_IMPLEMENTER_UNAVAILABLE')
    }
    const provider = subagents.getProvider(name)
    if (provider === undefined) {
      throw new EnvironmentRunError(`implementer provider "${name}" is unavailable: no subagent provider is registered under that name`, 'ENVIRONMENT_RUN_IMPLEMENTER_UNAVAILABLE')
    }
    const isolation = this.resolved.isolation
    if (runsOutOfProcess(provider.capabilities) && isolation !== 'none') {
      throw new EnvironmentRunError(`implementer provider "${name}" runs outside this process, where the read-barrier census cannot confine it, so it cannot implement a run declaring "${isolation}" isolation`, 'ENVIRONMENT_RUN_IMPLEMENTER_UNCONFINED')
    }
    if (!provider.capabilities.model) {
      throw new EnvironmentRunError(`implementer provider "${name}" cannot be told which model to run, so a run stamped with model "${model.model}" would measure whichever model that provider defaults to`, 'ENVIRONMENT_RUN_IMPLEMENTER_MODEL_UNSUPPORTED')
    }
    return {
      kind: 'subagent',
      provider: name,
      ...label === undefined ? {} : { label },
      subagents,
      budgets: this.requireBudgets(name),
    }
  }

  /**
   * The budget policy a delegated run is bounded by. A cell whose attempts run
   * on the session's own route reaches the policy's own pre-step check, so a
   * deployment that composes none has simply chosen no budgets; a delegated
   * attempt reaches no step here at all, so without the policy nothing would
   * bound it and the run is refused instead.
   * @param name - the implementer provider, named in the refusal.
   * @returns the composed budget policy.
   * @throws {@link EnvironmentRunError} when no budget policy is composed.
   */
  private requireBudgets(name: string): SessionBudgets {
    const budgets = this.ctx.get('sessionBudgets')
    if (budgets === undefined) {
      throw new EnvironmentRunError(`implementer provider "${name}" does the work of its attempts outside this session's own model route, where only the budget policy's caps can bound it, and this composition has none`, 'ENVIRONMENT_RUN_IMPLEMENTER_UNBOUNDED')
    }
    return budgets
  }

  /**
   * The caps one cell runs under, before the cell's own session tightens them.
   * A planner compares two arms with it: arms whose cells run under different
   * caps measure different things, however identical the rest of the plan is.
   *
   * A cell on the session's own route runs under every cap the deployment
   * configured. A delegated cell runs under the caps this runner can measure for
   * an implementer that spends outside this process, which is every one of them
   * except a cost cap the deployment states no foreign exchange rate for.
   *
   * @param implementer - who does the work of the cell's attempts.
   * @returns the caps in cap evaluation order; empty without a composed budget policy.
   * @throws {@link EnvironmentRunError} when a delegated implementer has no budget policy to bound it.
   */
  cellCaps(implementer: EnvironmentRunImplementer): readonly BudgetCap[] {
    switch (implementer.kind) {
      case 'route':
        return this.ctx.get('sessionBudgets')?.configuredCaps() ?? []
      case 'subagent': {
        const budgets = this.requireBudgets(implementer.provider)
        const caps = budgets.configuredCaps()
        return budgets.pricesForeignCost() ? caps : caps.filter(([cap]) => cap !== 'maxCostEur')
      }
      /* v8 ignore next 2 -- EnvironmentRunImplementer is closed and every member is handled above */
      default:
        return assertNever(implementer, 'run implementer')
    }
  }

  /**
   * Stamp, goal, standard, then the attempt loop; the session is flushed on
   * every path. The stamp is the authority on the run's routing: its `ladder`
   * gives both the attempt bound and the route of each attempt, and a run
   * without one gives every attempt the stamped model under the configured
   * `maxAttempts`.
   */
  private async drive(
    agent: Agent,
    definition: EnvironmentDefinition,
    stamp: EnvironmentRunStamp,
    request: EnvironmentRunRequest,
    implementer: RunImplementer,
    selection: ModelSelectionRef,
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
    let directive: DirectiveRequest | undefined
    const transcript = implementerTranscript(implementer)
    const maxAttempts = stamp.ladder?.length ?? this.resolved.maxAttempts
    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const model = stamp.ladder?.[attempt - 1] ?? stamp.model
        // The route implementer reads its selection as each step enters prompt
        // assembly, so the rung is applied before the attempt's first step and
        // the step's own request header records what it was asked for.
        selection.current = { provider: model.provider, model: model.model }
        const delivery: AttemptDelivery = {
          attempt,
          ...attemptText(implementer, definition.task.prompt, directive),
          model,
          ...request.signal === undefined ? {} : { signal: request.signal },
        }
        // An exhausted budget blocks every attempt it did not pay for, which is
        // what makes a delegated cell that ran out a failed cell rather than a
        // longer one. A blocked attempt left the workspace exactly as the last
        // validation already measured it, so the run ends without measuring it
        // again.
        const outcome = await this.implement(agent, implementer, delivery)
        if (outcome === 'blocked') break
        const standard = this.currentStandard(agent, goal.id)
        const ref = { id: standard.id, revision: standard.revision }
        if (await hashCheckOwned(request.workspace, runDirectory, immutable) !== checkOwned) {
          attempts.push(await this.recordTamper(agent, implementer, standard, ref, request.workspace, delivery, transcript))
          break
        }
        const treeHash = await restoreFixture(request.workspace, definition.task)
        const scripts = await materializeChecks(runDirectory, standard, bodies)
        // The validator just rewrote its own directory, so the set it now owns
        // is the baseline the next attempt must still find.
        checkOwned = await hashCheckOwned(request.workspace, runDirectory, immutable)
        const results = await this.execute(standard.checks, request, scripts, bodies)
        const validation = completionStandards.recordRun(agent, ref, this.resolved.isolation, results, {
          executor: 'runner',
          treeHash,
        })
        attempts.push({ attempt, model, transcript, results, treeHash })
        if (validation.certified) {
          certificate = validation.certificate
          const current = goals.get(agent)
          if (current === undefined || current.id !== goal.id) {
            throw new EnvironmentRunError(`the implementer replaced goal "${goal.id}"`, 'ENVIRONMENT_RUN_GOAL_REPLACED')
          }
          goals.complete(agent, { id: current.id, revision: current.revision })
          break
        }
        if (outcome === 'cut-short') break
        directive = describeFailures(validation.failures, standard.checks, this.resolved.evidenceMaxChars)
        completionStandards.issueDirective(agent, ref, directive)
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
      caps: this.cellCaps(implementer),
      escapesDenied: deniedReads(agent.session.events),
    }
  }

  /**
   * Hand one attempt's text to the implementer and wait for its work to end:
   * one user turn on the cell agent for a route run, one child run on the
   * named provider for a delegated one.
   * @param agent - the cell agent, which drives a route attempt and parents a delegated one.
   * @param implementer - who does the work of this attempt.
   * @param delivery - the attempt number, its text, its route, and the run's cancellation.
   * @returns how the attempt ended, which decides whether the run continues.
   */
  private async implement(
    agent: Agent,
    implementer: RunImplementer,
    delivery: AttemptDelivery,
  ): Promise<AttemptOutcome> {
    switch (implementer.kind) {
      case 'route':
        // A route attempt proposes steps, so the policy's own pre-step check
        // measures and stops it without the runner asking.
        await this.deliver(agent, delivery.text)
        return 'ran'
      case 'subagent':
        return this.delegate(agent, implementer, delivery)
      /* v8 ignore next 2 -- RunImplementer is closed and every member is handled above */
      default:
        return assertNever(implementer, 'run implementer')
    }
  }

  /** Send one user turn to the implementer and wait for the whole agent to go idle. */
  private async deliver(agent: Agent, text: string): Promise<void> {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }

  /**
   * Run one attempt as one child of the named subagent provider, rooted in the
   * cell workspace because every provider derives the child's working
   * directory from the delegating parent session's `cwd`. The run's outcome is
   * recorded rather than judged: whatever the child reports, the checks decide
   * what the tree it left is worth, so a refusal or a transport failure ends
   * the attempt exactly where a completed one does — at the validation.
   * The child is started on the attempt's own rung — the stamped model for a
   * run without a ladder — so the arm a cell is published under is the arm that
   * did the work; what the child's backend then reports it ran, and what it
   * says that run cost, are recorded beside it rather than assumed. The
   * reported spend is the only spend an out-of-process implementer leaves here,
   * and it is what separates two implementers that both certify on their first
   * attempt.
   * The cell's budget bounds the attempt exactly as it bounds a step of a route
   * cell: the caps are measured before the child starts, so an exhausted budget
   * blocks the attempt without paying for it, and what the child reported
   * spending is charged to the session so the next attempt's measurement sees
   * it. Measuring only before an attempt is what the pre-step check does, and
   * it is why a cell that certifies on the attempt that exhausted its budget
   * still completes. The wall budget left is armed as a deadline on the child's
   * signal, so an attempt that would outlast the cap is cancelled at it,
   * recorded as `budget-deadline`, and followed by the breach it caused.
   *
   * @param agent - the cell agent, which is the delegating parent and holds the durable record.
   * @param implementer - the provider, its optional label, and the resolved services.
   * @param delivery - the attempt number, its text, its rung, whether that text restated the task, and the run's cancellation.
   * @returns how the attempt ended, which decides whether the run continues.
   */
  private async delegate(
    agent: Agent,
    implementer: Extract<RunImplementer, { kind: 'subagent' }>,
    delivery: AttemptDelivery,
  ): Promise<AttemptOutcome> {
    const { budgets } = implementer
    const before = budgets.enforce(agent)
    if (before.breach !== undefined) return 'blocked'
    const deadline = new DelegationDeadline(before.remainingWallMs, delivery.signal)
    try {
      await this.startAndRecord(agent, implementer, delivery, deadline)
    } catch (error: unknown) {
      // A provider rejects a start its signal already aborted. When the cell's
      // own deadline is what aborted it, the attempt ended at the wall cap with
      // no child to record; anything else is the provider's failure.
      if (!deadline.expired) throw error
    } finally {
      deadline.dispose()
    }
    if (!deadline.expired) return 'ran'
    // The deadline, not the next measurement, is what ended this run, so the
    // breach is recorded here rather than before an attempt that never starts.
    budgets.enforce(agent)
    return 'cut-short'
  }

  /**
   * Start one child run, wait for it, and record what it did and what it spent.
   * The provider is told the rung's model id alone: a provider names its own
   * models, so the rung's harness provider is what the stamp records and not
   * what the child is started with.
   */
  private async startAndRecord(
    agent: Agent,
    implementer: Extract<RunImplementer, { kind: 'subagent' }>,
    delivery: AttemptDelivery,
    deadline: DelegationDeadline,
  ): Promise<void> {
    const { attempt, restatedTask } = delivery
    const run = await implementer.subagents.start(implementer.provider, {
      prompt: [{ type: 'text', text: delivery.text }],
      parent: agent,
      signal: deadline.signal,
      model: delivery.model.model,
      ...implementer.label === undefined ? {} : { label: implementer.label },
    })
    try {
      const result = await run.result
      // Only an in-process child's tokens were spent on a route this process
      // owns; an out-of-process one leaves no log here to sum.
      const usage = run.localAgent === undefined ? undefined : totalUsage(run.localAgent.session.events)
      agent.session.append('environment/delegation', {
        attempt,
        restatedTask,
        provider: implementer.provider,
        runId: run.id,
        stopReason: deadline.expired ? 'budget-deadline' : result.stopReason,
        ...result.structured === undefined ? {} : { structured: result.structured },
        ...usage === undefined ? {} : { usage },
        ...result.reportedModel === undefined ? {} : { reportedModel: result.reportedModel },
        ...result.reportedUsage === undefined ? {} : { reportedUsage: result.reportedUsage },
        ...result.reportedCostUsd === undefined ? {} : { reportedCostUsd: result.reportedCostUsd },
      })
      // At most one of the two accounts for the child — a backend that reports
      // its own usage runs where this process keeps no log — so the charge is
      // what the child spent, never a sum of two views of the same tokens.
      const spent = result.reportedUsage ?? usage
      implementer.budgets.recordForeignSpend(agent.session, {
        ref: run.id,
        source: implementer.provider,
        ...spent === undefined ? {} : { usage: spent },
        ...result.reportedCostUsd === undefined ? {} : { costUsd: result.reportedCostUsd },
      })
    } finally {
      await run.dispose()
    }
  }

  /**
   * Record one attempt whose check-owned set changed under the validator. The
   * checks are not executed — the workspace no longer measures the task — so
   * every result records that, the run is recorded as `tampered` and certifies
   * nothing, and a route implementer receives the tamper directive as its last
   * validation follow-up before the attempt loop ends.
   * @param agent - the cell agent whose attempt this is.
   * @param implementer - who did the work, which decides whether a follow-up turn is delivered at all.
   * @param standard - the standard the attempt would have measured.
   * @param ref - that standard's exact revision.
   * @param workspace - the run's workspace, digested as the attempt left it.
   * @param delivery - the attempt this was, and the rung it ran on.
   * @param transcript - what this implementer carries between attempts, restated on the attempt record.
   * @returns the attempt the report carries.
   */
  private async recordTamper(
    agent: Agent,
    implementer: RunImplementer,
    standard: StandardView,
    ref: StandardRef,
    workspace: string,
    delivery: AttemptDelivery,
    transcript: EnvironmentRunTranscript,
  ): Promise<EnvironmentRunAttempt> {
    const results: CheckResult[] = standard.checks.map(check => ({
      checkId: check.id,
      status: 'fail',
      evidence: bound(TAMPER_EVIDENCE, this.resolved.evidenceMaxChars),
    }))
    const treeHash = await hashWorkspaceTree(workspace)
    this.ctx.completionStandards.recordRun(agent, ref, this.resolved.isolation, results, {
      executor: 'runner',
      treeHash,
      tampered: true,
    })
    this.ctx.completionStandards.issueDirective(agent, ref, TAMPER_DIRECTIVE)
    // A delegated cell has no transcript of its own to carry the directive, and
    // starting one more external run over a void attempt would buy work no
    // certificate can follow; the recorded directive is the whole record there.
    if (implementer.kind === 'route') await this.deliver(agent, followupText(TAMPER_DIRECTIVE))
    return { attempt: delivery.attempt, model: delivery.model, transcript, results, treeHash }
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
   * @param definition - the environment being run, supplying the held-out fixture and the reference.
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
    await copyReference(definition.task, runDirectory)
    return runDirectory
  }

  /**
   * Mint one agent's reservation and copy the environment's reference program
   * beneath it, for a validator that derives the standard from that reference
   * before an implementer is ever driven. The copy lands in the same
   * {@link REFERENCE_DIR} the runner stocks for its own implementer, so the
   * instrument finds the reference at one path whichever session holds it, and
   * the whole reservation stays inside the check-owned digest.
   * @param agent - the agent whose session the reservation belongs to.
   * @param environment - the environment supplying the reference tree.
   * @returns the reservation the reference was staged in.
   * @throws {@link EnvironmentRunError} when the environment is unknown, it
   *   declares no reference, or no read barrier is composed to reserve from.
   */
  async stageReference(agent: Agent, environment: EnvironmentId): Promise<string> {
    const definition = this.ctx.environments.get(environment)
    if (definition === undefined) {
      throw new EnvironmentRunError(`environment "${environment}" is not registered`, 'ENVIRONMENT_RUN_UNKNOWN_ENVIRONMENT')
    }
    if (definition.task.reference === undefined) {
      throw new EnvironmentRunError(`environment "${environment}" declares no task reference to stage`, 'ENVIRONMENT_RUN_NO_REFERENCE')
    }
    const barrier = this.ctx.get('readBarrier')
    if (barrier === undefined) {
      throw new EnvironmentRunError('staging a reference requires a composed read barrier to reserve from', 'ENVIRONMENT_RUN_NO_RESERVATION')
    }
    const runDirectory = barrier.reserve(agent)
    await copyReference(definition.task, runDirectory)
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
        const result = await this.ctx.shell.run(this.checkSpec(command, request))
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

  /** Resolve one caseless check's command against the workspace and the run's cancellation. */
  private checkSpec(command: string, request: EnvironmentRunRequest): ShellExecSpec {
    return this.ctx.shell.resolve({
      command,
      workdir: request.workspace,
      timeoutMs: this.resolved.checkTimeoutMs,
      signal: request.signal,
    })
  }

  /**
   * Run one cased check case by case through {@link captureCase}, then compare
   * every configured channel against the case's digest.
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
      const { result, scope } = await captureCase(this.ctx.shell, {
        workspace: request.workspace,
        command,
        input: body.input,
        ...check.treeScope === undefined ? {} : { treeScope: check.treeScope },
        ...this.resolved.checkTimeoutMs === undefined ? {} : { timeoutMs: this.resolved.checkTimeoutMs },
        ...request.signal === undefined ? {} : { signal: request.signal },
      })
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
