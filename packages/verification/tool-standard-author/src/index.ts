/**
 * The validation instrument: one model-facing `standard_author` tool with which
 * a validator derives a completion standard of weighted cases from the
 * reference program staged under its reservation. `record_case` runs the
 * reference twice under the same four-channel capture the environment runner
 * measures a candidate with and keeps the digests both runs agreed on;
 * `weigh` restates a case's share; `freeze` writes the case bodies beside the
 * reservation's check directories and authors or extends the standard. The
 * [validation-instrument Agent Note](../../../.agents/notes/proposed/architecture/2026-09-06-validation-instrument.md)
 * owns the design rationale.
 * @module @deepseek-ai/dsh-tool-standard-author
 */

import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  captureCase,
  caseExpectation,
  REFERENCE_DIR,
  REFERENCE_ENTRY,
} from '@deepseek-ai/dsh-environment-runner'
// Type-only: this package declares the `recreation` kind into the registry's map.
import type {} from '@deepseek-ai/dsh-environments/types'
import type {} from '@deepseek-ai/dsh-goal'
import { assertNever, HarnessError } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-read-barrier'
import type { Session } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolAuthority, ToolExecution } from '@deepseek-ai/dsh-tools'
import { checkCasesRef, CheckCaseId, CheckId, isKebabCase } from '@deepseek-ai/dsh-verification'
import type {
  AuthoredCheck,
  CheckCase,
  CheckCaseChannel,
  CheckCaseComparator,
  CheckCaseExpectation,
  CheckCaseInput,
  CheckCaseNormalizer,
} from '@deepseek-ai/dsh-verification/types'

declare module '@deepseek-ai/dsh-tools/types' {
  interface ToolAuthorityMap {
    /**
     * The tool derives what a task is measured by: it executes the reference
     * program a recreation environment hides from the implementer and writes
     * the completion standard's case bodies.
     */
    'standard-author': 'standard-author'
  }
}

declare module '@deepseek-ai/dsh-environments/types' {
  interface EnvironmentKindMap {
    /**
     * A task whose completion standard a validator derives by sampling the
     * reference program under `task.reference`, rather than one whose checks
     * an author wrote by hand. The kind carries no further detail: the
     * reference directory is the whole of what it adds.
     */
    recreation: Record<string, never>
  }
}

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-standard-author'

/** Capability services the instrument consumes. */
export const inject = ['tools', 'shell', 'readBarrier', 'goals', 'completionStandards']

/**
 * The authority this tool declares about itself. A session whose role the read
 * barrier denies may neither compose it nor call it, which is what keeps an
 * implementer from executing the reference it is measured against.
 */
export const STANDARD_AUTHOR_AUTHORITY: readonly ToolAuthority[] = ['standard-author']

/** Subdirectory of a reservation holding one directory per check. */
const CHECKS_DIR = 'checks'

/** File inside a check's reserved directory holding one case body per line. */
const CASES_FILE = 'cases.jsonl'

/**
 * Scratch directory of a reservation the reference is sampled in. It is emptied
 * before every run, so the reference works from the same starting tree a
 * candidate later will and one sample never inherits the previous one's files.
 */
const SAMPLING_DIR = 'sampling'

/**
 * Times the reference runs for one recorded case. A second run is what proves
 * the expected values are a property of the reference rather than of one
 * execution; it is a property of the measurement, not a deployment choice.
 */
const REFERENCE_RUNS = 2

/**
 * The run instruction a frozen check takes when its author states none: the
 * candidate's own entry point at the workspace root, sourced exactly as the
 * reference's {@link REFERENCE_ENTRY} is. A recreation task asks for the
 * reference's behaviour at that entry point, so the default measures the
 * program the task named rather than one the instrument invented.
 */
export const DEFAULT_CHECK_RUN = `. ./${REFERENCE_ENTRY}`

/** Stable error codes of a refused authoring step. */
export type StandardAuthorErrorCode =
  | 'STANDARD_AUTHOR_NO_RESERVATION'
  | 'STANDARD_AUTHOR_NO_REFERENCE'
  | 'STANDARD_AUTHOR_NONDETERMINISTIC'
  | 'STANDARD_AUTHOR_INVALID_CASE'
  | 'STANDARD_AUTHOR_NO_GOAL'

/** Error returned by the instrument boundary; its message is what the validator reads. */
export class StandardAuthorError extends HarnessError {
  /**
   * @param message - the refusal, stated for the validator that called the tool.
   * @param code - stable machine-routable classification.
   */
  // Keep the constructor to narrow HarnessError's string code at this boundary.
  // oxlint-disable-next-line typescript/no-useless-constructor -- type-only narrowing
  constructor(message: string, code: StandardAuthorErrorCode) {
    super(message, code)
  }
}

/** Deployment choices of the instrument, validated from `cordis.yml`. */
export interface Config {
  /**
   * Timeout of each reference execution in milliseconds, capped by the
   * executor; absent applies the executor default. A reference that overruns it
   * records no case, so the bound is the deployment's statement of how long one
   * behavioural sample may take.
   */
  referenceTimeoutMs?: number
}

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  referenceTimeoutMs: z.natural().min(1),
})

/** One case as the working set holds it before a `freeze` writes it. */
interface RecordedCase {
  readonly id: string
  weight: number
  readonly input: CheckCaseInput
  readonly expected: CheckCaseExpectation
  readonly comparator: CheckCaseComparator
}

/** One check's recorded cases in the order they were sampled, and the tree scope they share. */
interface RecordedCheck {
  readonly cases: Map<string, RecordedCase>
  treeScope?: string
}

/** One validator session's unfrozen cases, keyed by check id in sampling order. */
type WorkingSet = Map<string, RecordedCheck>

/** Refuse one authoring step, stating the reason for the validator. */
function refuse(message: string, code: StandardAuthorErrorCode): never {
  throw new StandardAuthorError(message, code)
}

/** The calling agent; the instrument authors into one session's own standard, so an agentless call has none. */
function requireAgent(exec: ToolExecution): Agent {
  const agent = exec.agent
  if (agent === undefined) {
    refuse('standard_author authors the standard of the calling session, and this call has no session', 'STANDARD_AUTHOR_NO_RESERVATION')
  }
  return agent
}

/** Model-facing arguments after the registry validated them against the schema. */
interface StandardAuthorArgs {
  readonly action: 'record_case' | 'weigh' | 'freeze'
  readonly checkId?: string
  readonly caseId?: string
  readonly weight?: number
  readonly argv?: readonly string[]
  readonly stdin?: string
  readonly files?: readonly { readonly path: string; readonly content: string }[]
  readonly channels?: readonly CheckCaseChannel[]
  readonly normalizers?: readonly CheckCaseNormalizer[]
  readonly treeScope?: string
  readonly checks?: readonly {
    readonly id: string
    readonly outcome: string
    readonly run?: string
    readonly treeScope?: string
  }[]
}

/** What one call answers, rendered to the validator as {@link StandardAuthorResult.summary}. */
export interface StandardAuthorResult {
  /** The verb that ran. */
  readonly action: 'record_case' | 'weigh' | 'freeze'
  /** The complete account of what the call did, in the validator's own terms. */
  readonly summary: string
  /** Check the call touched, absent for a `freeze`. */
  readonly checkId?: string
  /** Case the call touched, absent for a `freeze`. */
  readonly caseId?: string
  /** Weight the case now carries, absent for a `freeze`. */
  readonly weight?: number
  /** Channels the recorded case compares, absent outside `record_case`. */
  readonly channels?: string[]
  /** Checks the freeze added to the standard, absent outside `freeze`. */
  readonly checks?: number
  /** Cases those checks carry, absent outside `freeze`. */
  readonly cases?: number
  /** Summed weight of those cases, absent outside `freeze`. */
  readonly weightTotal?: number
  /** Standard revision the freeze produced, absent outside `freeze`. */
  readonly revision?: number
}

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', required: true, enum: ['record_case', 'weigh', 'freeze'] },
    summary: { type: 'string', required: true },
    checkId: { type: 'string' },
    caseId: { type: 'string' },
    weight: { type: 'integer' },
    channels: { type: 'array', items: { type: 'string' } },
    checks: { type: 'integer' },
    cases: { type: 'integer' },
    weightTotal: { type: 'integer' },
    revision: { type: 'integer' },
  },
} as const

const DESCRIPTION = 'Derive the completion standard for this task from the reference program you were given. '
  + '`record_case` runs the reference on one input and keeps what it produced as the expected result of a new '
  + 'weighted case; it runs the reference twice and refuses inputs whose result changes between runs. '
  + '`weigh` restates a recorded case\'s weight. `freeze` turns the recorded cases into the standard the '
  + 'implementer will be measured by; nothing you record counts until you freeze it. '
  + 'You never see the implementer\'s work, and the implementer never sees the reference, the cases, or this tool.'

const PROMPT_TEXT = 'You author the standard this task is measured by, before any implementation exists. '
  + 'Sample the reference program with standard_author: cover the behaviour the task statement promises, '
  + 'weight each case by how much a user would miss it, and freeze the cases into the standard when the '
  + 'sample is complete. Load the standard-sampling skill for how to choose the sample.'

/** Every channel a case may compare, in the canonical order a comparator lists them. */
const CHANNELS: readonly CheckCaseChannel[] = ['exit', 'stdout', 'stderr', 'tree']

/** Require one model-supplied argument the called verb cannot run without. */
function required<T>(value: T | undefined, field: string, action: string): T {
  if (value === undefined) refuse(`"${field}" is required for the "${action}" action`, 'STANDARD_AUTHOR_INVALID_CASE')
  return value
}

/** Require one lower-kebab-case identity, which is also what makes it usable as a path segment. */
function identity(value: string, field: string): string {
  if (!isKebabCase(value)) refuse(`${field} "${value}" must be lower-kebab-case`, 'STANDARD_AUTHOR_INVALID_CASE')
  return value
}

/** Require a positive safe-integer weight, which is the share a case carries of its check. */
function weightOf(value: number, caseId: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    refuse(`weight of case "${caseId}" must be a positive whole number`, 'STANDARD_AUTHOR_INVALID_CASE')
  }
  return value
}

/**
 * Require a non-empty channel set without repeats, in the canonical order. The
 * schema's own enumeration already rejects a channel outside the vocabulary, so
 * only the two constraints it cannot express are checked here.
 */
function channelsOf(values: readonly CheckCaseChannel[], caseId: string): CheckCaseChannel[] {
  if (values.length === 0) refuse(`case "${caseId}" compares no channel`, 'STANDARD_AUTHOR_INVALID_CASE')
  const declared = new Set<CheckCaseChannel>()
  for (const value of values) {
    if (declared.has(value)) refuse(`case "${caseId}" repeats channel "${value}"`, 'STANDARD_AUTHOR_INVALID_CASE')
    declared.add(value)
  }
  return CHANNELS.filter(channel => declared.has(channel))
}

/** The case input one `record_case` feeds the reference and every later candidate. */
function inputOf(args: StandardAuthorArgs): CheckCaseInput {
  const files = args.files
  return {
    argv: [...args.argv ?? []],
    ...args.stdin === undefined ? {} : { stdin: args.stdin },
    ...files === undefined || files.length === 0
      ? {}
      : { files: Object.fromEntries(files.map(entry => [entry.path, entry.content])) },
  }
}

/** The channels whose expected value differs between two captures of the reference. */
function unstableChannels(
  first: CheckCaseExpectation,
  second: CheckCaseExpectation,
  comparator: CheckCaseComparator,
): CheckCaseChannel[] {
  const fields: Readonly<Record<CheckCaseChannel, keyof CheckCaseExpectation>> = {
    exit: 'exitCode',
    stdout: 'stdoutSha256',
    stderr: 'stderrSha256',
    tree: 'treeSha256',
  }
  return comparator.channels.filter(channel => first[fields[channel]] !== second[fields[channel]])
}

/** The channels a capture could not put an expected value on, so no candidate could ever match them. */
function unrecordedChannels(
  expected: CheckCaseExpectation,
  comparator: CheckCaseComparator,
): CheckCaseChannel[] {
  const fields: Readonly<Record<CheckCaseChannel, keyof CheckCaseExpectation>> = {
    exit: 'exitCode',
    stdout: 'stdoutSha256',
    stderr: 'stderrSha256',
    tree: 'treeSha256',
  }
  return comparator.channels.filter(channel => expected[fields[channel]] === undefined)
}

/** The instrument's per-session state; a session's set dies with its session. */
const workingSets = new WeakMap<Session, WorkingSet>()

/** The working set of one validator session, created on first use. */
function workingSet(session: Session): WorkingSet {
  const existing = workingSets.get(session)
  if (existing !== undefined) return existing
  const created: WorkingSet = new Map()
  workingSets.set(session, created)
  return created
}

/**
 * The reservation this session holds, which is where its reference program and
 * its case bodies live. A session without one has nothing to author from: the
 * instrument never mints a reservation, because holding one is what makes an
 * otherwise unmarked session the implementer.
 */
function reservationOf(ctx: Context, agent: Agent): string {
  const directory = ctx.readBarrier.reservation(agent)
  if (directory === undefined) {
    refuse('this session holds no reserved directory, so there is no reference program to author from', 'STANDARD_AUTHOR_NO_RESERVATION')
  }
  return directory
}

/** The reference entry point of one reservation, or a refusal naming that none was staged. */
async function referenceEntry(reservation: string): Promise<string> {
  const entry = join(reservation, REFERENCE_DIR, REFERENCE_ENTRY)
  try {
    if ((await stat(entry)).isFile()) return entry
  } catch {
    // stat rejects for a missing or unreadable entry; either way this session
    // was given no reference program, which is the refusal below.
  }
  return refuse('no reference program was staged for this session, so there is nothing to sample', 'STANDARD_AUTHOR_NO_REFERENCE')
}

/** One check's entry in the working set, created on first recorded case. */
function recordedCheck(set: WorkingSet, checkId: string): RecordedCheck {
  const existing = set.get(checkId)
  if (existing !== undefined) return existing
  const created: RecordedCheck = { cases: new Map() }
  set.set(checkId, created)
  return created
}

/** The case bodies of one recorded check, in sampling order. */
function bodiesOf(check: RecordedCheck): CheckCase[] {
  return [...check.cases.values()].map(body => ({
    id: CheckCaseId(body.id),
    weight: body.weight,
    input: body.input,
    expected: body.expected,
    comparator: body.comparator,
  }))
}

/** Write one check's case bodies beside its reserved directory, one JSON body per line. */
async function writeCaseBodies(reservation: string, checkId: string, bodies: readonly CheckCase[]): Promise<void> {
  const directory = join(reservation, CHECKS_DIR, checkId)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await writeFile(
    join(directory, CASES_FILE),
    bodies.map(body => `${JSON.stringify(body)}\n`).join(''),
    { mode: 0o600 },
  )
}

/** Everything one sampling run of the reference needs, fixed for the whole case. */
interface Sampling {
  /** Scratch directory the reference runs in, emptied before every run. */
  readonly workspace: string
  /** Absolute reference entry point the run sources. */
  readonly entry: string
  /** What the case feeds the reference. */
  readonly input: CheckCaseInput
  /** Channels the case compares and the normalizers applied first. */
  readonly comparator: CheckCaseComparator
  /** Workspace-relative tree scope, absent for a case comparing no tree. */
  readonly treeScope?: string
  /** Per-run timeout, absent to apply the executor default. */
  readonly timeoutMs?: number
  /** Cancellation of the enclosing tool call. */
  readonly signal: AbortSignal
}

/**
 * Run the reference once from an empty scratch workspace and digest what it
 * produced on the case's channels. Emptying first is what makes two runs of one
 * input comparable: a file the previous run left would otherwise be part of the
 * next run's tree.
 */
async function sampleReference(ctx: Context, sampling: Sampling): Promise<CheckCaseExpectation> {
  await rm(sampling.workspace, { recursive: true, force: true })
  await mkdir(sampling.workspace, { recursive: true, mode: 0o700 })
  const capture = await captureCase(ctx.shell, {
    workspace: sampling.workspace,
    command: `. ${sampling.entry}`,
    input: sampling.input,
    ...sampling.treeScope === undefined ? {} : { treeScope: sampling.treeScope },
    ...sampling.timeoutMs === undefined ? {} : { timeoutMs: sampling.timeoutMs },
    signal: sampling.signal,
  })
  return await caseExpectation(capture, sampling.comparator)
}

/** Record one case: sample the reference twice, then keep the digests as the case's expectation. */
async function recordCase(
  ctx: Context,
  agent: Agent,
  args: StandardAuthorArgs,
  timeoutMs: number | undefined,
  signal: AbortSignal,
): Promise<StandardAuthorResult> {
  const checkId = identity(required(args.checkId, 'checkId', 'record_case'), 'checkId')
  const caseId = identity(required(args.caseId, 'caseId', 'record_case'), 'caseId')
  const set = workingSet(agent.session)
  const check = recordedCheck(set, checkId)
  if (check.cases.has(caseId)) {
    refuse(`check "${checkId}" already holds a case "${caseId}"; use weigh to change it or record it under another id`, 'STANDARD_AUTHOR_INVALID_CASE')
  }
  const weight = weightOf(required(args.weight, 'weight', 'record_case'), caseId)
  const channels = channelsOf(required(args.channels, 'channels', 'record_case'), caseId)
  const comparator: CheckCaseComparator = { channels, normalizers: [...args.normalizers ?? []] }
  const treeScope = args.treeScope ?? check.treeScope
  if (channels.includes('tree') && treeScope === undefined) {
    refuse(`case "${caseId}" compares the work tree without a treeScope to digest`, 'STANDARD_AUTHOR_INVALID_CASE')
  }
  if (!channels.includes('tree') && args.treeScope !== undefined && check.treeScope === undefined) {
    refuse(`case "${caseId}" declares a treeScope but compares no work tree`, 'STANDARD_AUTHOR_INVALID_CASE')
  }
  const reservation = reservationOf(ctx, agent)
  const sampling: Sampling = {
    workspace: join(reservation, SAMPLING_DIR),
    entry: await referenceEntry(reservation),
    input: inputOf(args),
    comparator,
    ...treeScope === undefined ? {} : { treeScope },
    ...timeoutMs === undefined ? {} : { timeoutMs },
    signal,
  }
  const runs: CheckCaseExpectation[] = []
  for (let run = 0; run < REFERENCE_RUNS; run += 1) runs.push(await sampleReference(ctx, sampling))
  // REFERENCE_RUNS is two, so both entries exist.
  const first = runs[0] as CheckCaseExpectation
  const unstable = unstableChannels(first, runs[1] as CheckCaseExpectation, comparator)
  if (unstable.length > 0) {
    refuse(
      `the reference did not produce the same ${unstable.join(', ')} twice for case "${caseId}"; `
      + 'a case whose expected result changes between runs cannot measure a candidate, so it was not recorded',
      'STANDARD_AUTHOR_NONDETERMINISTIC',
    )
  }
  const unrecorded = unrecordedChannels(first, comparator)
  if (unrecorded.length > 0) {
    refuse(
      `the reference produced no usable ${unrecorded.join(', ')} for case "${caseId}"; `
      + 'a channel without an expected result cannot measure a candidate, so it was not recorded',
      'STANDARD_AUTHOR_INVALID_CASE',
    )
  }
  check.cases.set(caseId, { id: caseId, weight, input: sampling.input, expected: first, comparator })
  if (treeScope !== undefined) check.treeScope = treeScope
  return {
    action: 'record_case',
    checkId,
    caseId,
    weight,
    channels,
    summary: `Recorded case "${caseId}" of check "${checkId}" at weight ${weight}, comparing ${channels.join(', ')}. `
      + `The reference produced the same result on both runs. Check "${checkId}" now holds ${check.cases.size} case(s).`,
  }
}

/** Restate one recorded case's weight. */
function weigh(agent: Agent, args: StandardAuthorArgs): StandardAuthorResult {
  const checkId = required(args.checkId, 'checkId', 'weigh')
  const caseId = required(args.caseId, 'caseId', 'weigh')
  const body = workingSet(agent.session).get(checkId)?.cases.get(caseId)
  if (body === undefined) {
    refuse(`no case "${caseId}" of check "${checkId}" has been recorded, so there is nothing to weigh`, 'STANDARD_AUTHOR_INVALID_CASE')
  }
  body.weight = weightOf(required(args.weight, 'weight', 'weigh'), caseId)
  return {
    action: 'weigh',
    checkId,
    caseId,
    weight: body.weight,
    summary: `Case "${caseId}" of check "${checkId}" now carries weight ${body.weight}.`,
  }
}

/** One frozen check together with the recorded entry it came from. */
interface FrozenCheck {
  readonly authored: AuthoredCheck
  readonly checkId: string
  readonly bodies: readonly CheckCase[]
}

/** Turn one requested check into the authored check the standard will carry. */
function freezeCheck(
  set: WorkingSet,
  request: { readonly id: string; readonly outcome: string; readonly run?: string; readonly treeScope?: string },
): FrozenCheck {
  const checkId = identity(request.id, 'check id')
  const recorded = set.get(checkId)
  if (recorded === undefined || recorded.cases.size === 0) {
    refuse(`check "${checkId}" has no recorded cases, so there is nothing to freeze`, 'STANDARD_AUTHOR_INVALID_CASE')
  }
  if (request.outcome.trim() === '') {
    refuse(`check "${checkId}" needs an outcome stating what the task must establish`, 'STANDARD_AUTHOR_INVALID_CASE')
  }
  if (request.treeScope !== undefined && request.treeScope !== recorded.treeScope) {
    refuse(
      `check "${checkId}" was recorded against treeScope ${JSON.stringify(recorded.treeScope ?? null)}, not ${JSON.stringify(request.treeScope)}`,
      'STANDARD_AUTHOR_INVALID_CASE',
    )
  }
  const bodies = bodiesOf(recorded)
  return {
    checkId,
    bodies,
    authored: {
      id: CheckId(checkId),
      outcome: request.outcome,
      run: request.run ?? DEFAULT_CHECK_RUN,
      cases: checkCasesRef(bodies),
      ...recorded.treeScope === undefined ? {} : { treeScope: recorded.treeScope },
      caseBodies: bodies,
    },
  }
}

/** Freeze the recorded cases into the standard the implementer will be measured by. */
async function freeze(ctx: Context, agent: Agent, args: StandardAuthorArgs): Promise<StandardAuthorResult> {
  const requests = required(args.checks, 'checks', 'freeze')
  if (requests.length === 0) refuse('freeze needs at least one check', 'STANDARD_AUTHOR_INVALID_CASE')
  const goal = ctx.goals.get(agent)
  if (goal === undefined) {
    refuse('this session has no goal for a standard to measure, so nothing can be frozen', 'STANDARD_AUTHOR_NO_GOAL')
  }
  const set = workingSet(agent.session)
  const frozen = requests.map(request => freezeCheck(set, request))
  const reservation = reservationOf(ctx, agent)
  for (const check of frozen) await writeCaseBodies(reservation, check.checkId, check.bodies)
  const authored = frozen.map(check => check.authored)
  const current = ctx.completionStandards.get(agent)
  const view = current === undefined || current.goalId !== goal.id
    ? ctx.completionStandards.author(agent, { goalId: goal.id, checks: authored })
    : ctx.completionStandards.extend(agent, { id: current.id, revision: current.revision }, authored)
  for (const check of frozen) set.delete(check.checkId)
  const cases = frozen.reduce((sum, check) => sum + check.bodies.length, 0)
  const weightTotal = frozen.reduce(
    (sum, check) => sum + check.bodies.reduce((inner, body) => inner + body.weight, 0),
    0,
  )
  return {
    action: 'freeze',
    checks: frozen.length,
    cases,
    weightTotal,
    revision: view.revision,
    summary: `Froze ${frozen.length} check(s) carrying ${cases} case(s) of total weight ${weightTotal}. `
      + `The standard measuring this task is now revision ${view.revision}; the implementer is measured by it and never sees it.`,
  }
}

/** The pending card of one call, derived from the verb alone so replay renders it identically. */
function presentCall(args: StandardAuthorArgs): {
  card: 'generic'
  title: string
  kind: 'execute' | 'other'
} {
  const named = typeof args.caseId === 'string' && args.caseId !== '' ? ` "${args.caseId}"` : ''
  switch (args.action) {
    case 'record_case':
      return { card: 'generic', title: `Sample the reference for case${named}`, kind: 'execute' }
    case 'weigh':
      return { card: 'generic', title: `Weigh case${named}`, kind: 'other' }
    default:
      // `action` is schema-constrained, and a logged call from an older build
      // renders as the freeze card rather than crashing a replay.
      return { card: 'generic', title: 'Freeze the completion standard', kind: 'other' }
  }
}

/**
 * Register the validator's `standard_author` tool and its guidance section.
 * @param ctx - the plugin context carrying the tool registry and the instrument's services.
 * @param config - validated deployment config.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({ name: 'tool:standard-author', order: 114, text: PROMPT_TEXT })
  })
  ctx.tools.register(defineTool({
    name: 'standard_author',
    authority: STANDARD_AUTHOR_AUTHORITY,
    description: DESCRIPTION,
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['record_case', 'weigh', 'freeze'],
        description: 'What to do: `record_case`, `weigh`, or `freeze`.',
      },
      checkId: {
        type: 'string',
        description: 'Required for `record_case` and `weigh`: lower-kebab-case name of the check the case belongs to.',
      },
      caseId: {
        type: 'string',
        description: 'Required for `record_case` and `weigh`: lower-kebab-case name of the case, unique inside its check.',
      },
      weight: {
        type: 'integer',
        description: 'Required for `record_case` and `weigh`: whole share of the check this case carries, by how much a user would miss the behaviour.',
      },
      argv: {
        type: 'array',
        items: { type: 'string' },
        description: 'Command words appended to the program under test. Each word must need no shell quoting.',
      },
      stdin: { type: 'string', description: 'Bytes written to the program\'s standard input, which is then closed.' },
      files: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', required: true, description: 'Workspace-relative path, `/`-separated, without `.` or `..` segments.' },
            content: { type: 'string', required: true, description: 'UTF-8 contents of the staged file.' },
          },
        },
        description: 'Files staged in the working directory before the case runs.',
      },
      channels: {
        type: 'array',
        items: { type: 'string', enum: ['exit', 'stdout', 'stderr', 'tree'] },
        description: 'Required for `record_case`: what the case compares. `tree` compares the files left under `treeScope`.',
      },
      normalizers: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['crlf', 'trailing-whitespace', 'blank-lines', 'iso8601-timestamps', 'temp-paths', 'json-canonical'],
        },
        description: 'Differences to ignore when comparing, applied in this order. Every one of them widens what counts as correct.',
      },
      treeScope: {
        type: 'string',
        description: 'Workspace-relative directory the `tree` channel compares; it is emptied before each case runs.',
      },
      checks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: 'Check whose recorded cases to freeze.' },
            outcome: { type: 'string', required: true, description: 'What the task must establish, stated without saying how.' },
            run: { type: 'string', description: `How to run the candidate; defaults to \`${DEFAULT_CHECK_RUN}\`.` },
            treeScope: { type: 'string', description: 'Restates the tree scope the cases were recorded against.' },
          },
        },
        description: 'Required for `freeze`: the checks to add to the standard, each carrying the cases recorded under its id.',
      },
    },
    output: {
      schema: RESULT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: value.summary }],
    },
    presentCall,
    execute: async (args, exec): Promise<StandardAuthorResult> => {
      switch (args.action) {
        case 'record_case':
          return await recordCase(ctx, requireAgent(exec), args, config.referenceTimeoutMs, exec.signal)
        case 'weigh':
          return weigh(requireAgent(exec), args)
        case 'freeze':
          return await freeze(ctx, requireAgent(exec), args)
        /* v8 ignore next 2 -- the schema constrains `action` to the three verbs above */
        default:
          return assertNever(args.action)
      }
    },
  }))
}
