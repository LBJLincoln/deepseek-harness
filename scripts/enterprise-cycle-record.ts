/**
 * The cycle record: one JSON file per run of `scripts/enterprise-cycle.sh`,
 * `data/enterprise/cycles/<cycle id>.json`, which the cycle writes
 * (`pnpm run enterprise:cycle-record`) after its last data step and commits in
 * its final commit, so the branch holds what every cycle did without the
 * container-local log.
 *
 * The cycle appends one line per step it ran to a temporary file,
 * `<name> <exit code> <UTC ISO time>`, and passes that file with the commits it
 * captured; this module reads them, takes the ledger rows the checkout gained
 * since the initial pull, and writes the record after validating it. A record
 * states only what the cycle observed before its final commit: the final push's
 * outcome belongs to the next cycle's record, as {@link CycleRecord.previous}.
 * The record file is a durable boundary; {@link cycleRecordProblems} is the one
 * validation both the writer and every reader apply.
 *
 * @module enterprise-cycle-record
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { LEDGER_PATH, parseLedgerLine, ticketStatus, type FunctionOutcome, type TicketStatus } from './enterprise-ledger.ts'

/** The directory of the cycle records, relative to the repository root. */
export const CYCLES_DIR = 'data/enterprise/cycles'

/** A cycle id as the cycle stamps it: `cycle-` and the UTC second the cycle began. */
const CYCLE_ID = /^cycle-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/

/** A full commit id. */
const COMMIT = /^[0-9a-f]{40}$/

/** A step name as the cycle script names its steps. */
const STEP_NAME = /^[a-z][a-z0-9-]*$/

/** One step of a cycle: its name, its exit code, and when it ended. */
export interface CycleStep {
  name: string
  /** The step's exit code, 0 to 255. */
  exit: number
  /** ISO time the step ended. */
  at: string
}

/** `data/enterprise/cycles/<cycle>.json`: what one cycle did, as it observed before its final commit. */
export interface CycleRecord {
  /** The cycle id, `cycle-<UTC stamp>`. */
  cycle: string
  /** ISO time the id stamps: the moment the cycle began. */
  startedAt: string
  /** ISO time the record was built, after the cycle's last data step and before its final commit. */
  endedAt: string
  /**
   * `start`: the checkout's commit when the cycle began, whose cycle script ran;
   * `pulled`: the checkout's commit after the initial pull, whose ledger the
   * cycle's lines are counted against; `end`: the checkout's commit when the
   * record was built, the parent of the cycle's final commit.
   */
  commits: { start: string; pulled: string; end: string }
  /** Every step that ran before the record, in order; a skipped step has no entry. */
  steps: CycleStep[]
  /** The shift ids of the ticket lines the ledger gained during the cycle, in ledger order. */
  shifts: string[]
  /** The ticket lines the ledger gained during the cycle, by status. */
  tickets: Record<TicketStatus, number>
  /** The function lines the ledger gained during the cycle, by outcome. */
  functions: Record<FunctionOutcome, number>
  /** Rows the ledger gained during the cycle that no ledger reader could use. */
  unreadable: number
  /** The first step that exited non-zero, or `null` when every step exited 0. */
  firstFailure: { step: string; exit: number } | null
  /**
   * The newest earlier record in the checkout, and whether it was on the
   * remote branch as the initial pull fetched it: `false` means that cycle's
   * final push had not delivered it, `null` that the remote branch could not
   * be read. `null` when the checkout holds no earlier record.
   */
  previous: { cycle: string; recordOnRemote: boolean | null } | null
}

/** A record file {@link readCycleRecords} could not use, and why. */
export interface UnreadableCycleRecord {
  path: string
  reason: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIsoTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isExitCode(value: unknown): value is number {
  return isCount(value) && value <= 255
}

/**
 * The moment a cycle id stamps.
 * @param cycle - a cycle id such as `cycle-20260928T221301Z`.
 * @returns the ISO time, or `undefined` when the id is not a cycle id.
 */
export function cycleStartedAt(cycle: string): string | undefined {
  const parts = CYCLE_ID.exec(cycle)
  if (parts === null) return undefined
  const [, year, month, day, hour, minute, second] = parts
  const ms = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined
}

/**
 * Read the step file the cycle script appends to: one `<name> <exit> <ISO time>` line per step.
 * @param text - the file's content.
 * @returns the steps in file order.
 * @throws on a line that is not a step, because a record must not guess at what the cycle wrote.
 */
export function parseStepLines(text: string): CycleStep[] {
  const steps: CycleStep[] = []
  for (const [index, row] of text.split('\n').entries()) {
    if (row.trim() === '') continue
    const [name, exit, at, ...rest] = row.trim().split(/\s+/)
    const code = Number(exit)
    if (name === undefined || !STEP_NAME.test(name) || !/^\d+$/.test(exit ?? '') || !isExitCode(code) || !isIsoTime(at) || rest.length > 0) {
      throw new Error(`enterprise-cycle-record: step line ${index + 1} is not "<name> <exit> <ISO time>": ${JSON.stringify(row)}`)
    }
    steps.push({ name, exit: code, at: new Date(at).toISOString() })
  }
  return steps
}

/**
 * Every reason a value is not a cycle record; the writer refuses to write and
 * the readers skip a record with any.
 * @param value - the decoded JSON value.
 * @returns the problems, empty for a valid record.
 */
export function cycleRecordProblems(value: unknown): string[] {
  if (!isRecord(value)) return ['not a JSON object']
  const problems: string[] = []
  const { cycle, startedAt, endedAt, commits, steps, shifts, tickets, functions, unreadable, firstFailure, previous } = value
  if (typeof cycle !== 'string' || cycleStartedAt(cycle) === undefined) problems.push('"cycle" is not a cycle id')
  else if (startedAt !== cycleStartedAt(cycle)) problems.push('"startedAt" is not the moment the cycle id stamps')
  if (!isIsoTime(endedAt)) problems.push('"endedAt" is not an ISO time')
  else if (isIsoTime(startedAt) && Date.parse(endedAt) < Date.parse(startedAt)) problems.push('"endedAt" precedes "startedAt"')
  if (!isRecord(commits) || !['start', 'pulled', 'end'].every(key => typeof commits[key] === 'string' && COMMIT.test(commits[key]))) {
    problems.push('"commits" does not name full "start", "pulled" and "end" commits')
  }
  const validSteps = Array.isArray(steps) && steps.length > 0 && steps.every(step =>
    isRecord(step) && typeof step.name === 'string' && STEP_NAME.test(step.name) && isExitCode(step.exit) && isIsoTime(step.at))
  if (!validSteps) problems.push('"steps" is not a non-empty list of { name, exit, at }')
  if (!Array.isArray(shifts) || !shifts.every(shift => typeof shift === 'string' && shift !== '')) problems.push('"shifts" is not a list of shift ids')
  if (!isRecord(tickets) || !['shipped', 'rejected', 'halted'].every(key => isCount(tickets[key]))) problems.push('"tickets" does not count shipped, rejected and halted')
  if (!isRecord(functions) || !['pass', 'fail', 'error'].every(key => isCount(functions[key]))) problems.push('"functions" does not count pass, fail and error')
  if (!isCount(unreadable)) problems.push('"unreadable" is not a count')
  if (validSteps) {
    const failed = (steps as CycleStep[]).find(step => step.exit !== 0)
    const expected = failed === undefined ? null : { step: failed.name, exit: failed.exit }
    if (JSON.stringify(firstFailure) !== JSON.stringify(expected)) problems.push('"firstFailure" is not the first step that exited non-zero')
  }
  const validPrevious = previous === null || (isRecord(previous)
    && typeof previous.cycle === 'string' && cycleStartedAt(previous.cycle) !== undefined
    && (previous.recordOnRemote === null || typeof previous.recordOnRemote === 'boolean'))
  if (!validPrevious) problems.push('"previous" is neither null nor { cycle, recordOnRemote }')
  return problems
}

/**
 * The ledger rows of `after` that `before` does not hold, compared as a
 * multiset of rows so a rebase that reorders appended rows still counts each
 * once.
 * @param before - the ledger's content at the cycle's initial pull.
 * @param after - the ledger's content when the record is built.
 * @returns the added rows, in `after`'s order.
 */
function addedRows(before: string, after: string): string[] {
  const rows = (content: string): string[] => content.split('\n').map(row => row.trim()).filter(row => row !== '')
  const remaining = new Map<string, number>()
  for (const row of rows(before)) remaining.set(row, (remaining.get(row) ?? 0) + 1)
  const added: string[] = []
  for (const row of rows(after)) {
    const left = remaining.get(row) ?? 0
    if (left > 0) remaining.set(row, left - 1)
    else added.push(row)
  }
  return added
}

/** What {@link buildCycleRecord} reads. */
export interface CycleRecordInput {
  cycle: string
  /** ISO time the record is built. */
  endedAt: string
  commits: CycleRecord['commits']
  steps: readonly CycleStep[]
  /** The ledger's content at `commits.pulled`. */
  ledgerBefore: string
  /** The ledger's content in the checkout when the record is built. */
  ledgerAfter: string
  previous: CycleRecord['previous']
}

/**
 * Build and validate a cycle record.
 * @param input - the cycle, its steps and commits, and the ledger before and after.
 * @returns the record.
 * @throws when the result is not a valid record, naming every problem.
 */
export function buildCycleRecord(input: CycleRecordInput): CycleRecord {
  const tickets: CycleRecord['tickets'] = { shipped: 0, rejected: 0, halted: 0 }
  const functions: CycleRecord['functions'] = { pass: 0, fail: 0, error: 0 }
  const shifts: string[] = []
  let unreadable = 0
  for (const row of addedRows(input.ledgerBefore, input.ledgerAfter)) {
    let decoded: unknown
    try {
      decoded = JSON.parse(row)
    } catch {
      // A torn row is counted as unreadable; the ledger's readers skip it the same way.
      unreadable += 1
      continue
    }
    const line = parseLedgerLine(decoded)
    if (typeof line === 'string') {
      unreadable += 1
    } else if (line.type === 'ticket') {
      tickets[ticketStatus(line)] += 1
      if (line.shift !== '' && !shifts.includes(line.shift)) shifts.push(line.shift)
    } else {
      functions[line.outcome] += 1
    }
  }
  const failed = input.steps.find(step => step.exit !== 0)
  const record: CycleRecord = {
    cycle: input.cycle,
    startedAt: cycleStartedAt(input.cycle) ?? '',
    endedAt: new Date(input.endedAt).toISOString(),
    commits: { ...input.commits },
    steps: input.steps.map(step => ({ ...step })),
    shifts,
    tickets,
    functions,
    unreadable,
    firstFailure: failed === undefined ? null : { step: failed.name, exit: failed.exit },
    previous: input.previous,
  }
  const problems = cycleRecordProblems(record)
  if (problems.length > 0) throw new Error(`enterprise-cycle-record: ${input.cycle}: ${problems.join('; ')}`)
  return record
}

/**
 * Read every cycle record under `root`.
 * @param root - repository root.
 * @returns the valid records in cycle order, and each unusable file with the reason.
 */
export function readCycleRecords(root: string): { records: CycleRecord[]; unreadable: UnreadableCycleRecord[] } {
  const dir = join(root, CYCLES_DIR)
  const read: { records: CycleRecord[]; unreadable: UnreadableCycleRecord[] } = { records: [], unreadable: [] }
  if (!existsSync(dir)) return read
  for (const name of readdirSync(dir).filter(entry => entry.endsWith('.json')).sort()) {
    const path = `${CYCLES_DIR}/${name}`
    let decoded: unknown
    try {
      decoded = JSON.parse(readFileSync(join(dir, name), 'utf8'))
    } catch {
      // A torn or hand-edited file; the other records still count.
      read.unreadable.push({ path, reason: 'not JSON' })
      continue
    }
    const problems = cycleRecordProblems(decoded)
    if (problems.length === 0 && `${(decoded as CycleRecord).cycle}.json` !== name) problems.push('the file is not named after its "cycle"')
    if (problems.length > 0) read.unreadable.push({ path, reason: problems.join('; ') })
    else read.records.push(decoded as CycleRecord)
  }
  return read
}

/** The command line the cycle script passes. */
export interface CycleRecordArguments {
  cycle: string
  /** The step file the cycle appended to. */
  steps: string
  start: string
  pulled: string
  /** The remote branch's commit after the initial pull, or `none` when the checkout has no such ref. */
  remote: string
}

/**
 * Read the CLI flags; a bare `--`, which `pnpm run` forwards, is skipped.
 * @param argv - the arguments after the script path.
 * @returns the flags.
 * @throws on an unknown flag, a flag without its value, or a missing flag.
 */
export function parseCycleRecordArguments(argv: readonly string[]): CycleRecordArguments {
  const flags = new Map<string, string>()
  const known = ['--cycle', '--steps', '--start', '--pulled', '--remote']
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index] ?? ''
    if (flag === '--') continue
    if (!known.includes(flag)) throw new Error(`enterprise-cycle-record: unknown flag ${flag}`)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`enterprise-cycle-record: ${flag} needs a value`)
    flags.set(flag, value)
    index += 1
  }
  const missing = known.filter(flag => !flags.has(flag))
  if (missing.length > 0) throw new Error(`enterprise-cycle-record: missing ${missing.join(', ')}`)
  const value = (flag: string): string => flags.get(flag) ?? ''
  return { cycle: value('--cycle'), steps: value('--steps'), start: value('--start'), pulled: value('--pulled'), remote: value('--remote') }
}

/**
 * Run git in `root`.
 * @returns its standard output, trimmed at the end.
 * @throws when git exits non-zero.
 */
function git(root: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 }).trimEnd()
}

/**
 * The newest record in the checkout older than `cycle`, and whether the remote branch held it.
 * @param root - repository root.
 * @param cycle - the running cycle.
 * @param remote - the remote branch's commit after the initial pull, or `none`.
 * @returns the previous record's status, or `null` when the checkout holds none.
 */
function previousRecord(root: string, cycle: string, remote: string): CycleRecord['previous'] {
  const dir = join(root, CYCLES_DIR)
  if (!existsSync(dir)) return null
  const earlier = readdirSync(dir)
    .map(name => name.replace(/\.json$/, ''))
    .filter(id => cycleStartedAt(id) !== undefined && id < cycle)
    .sort()
  const newest = earlier.at(-1)
  if (newest === undefined) return null
  if (remote === 'none') return { cycle: newest, recordOnRemote: null }
  let onRemote = true
  try {
    git(root, ['cat-file', '-e', `${remote}:${CYCLES_DIR}/${newest}.json`])
  } catch {
    // cat-file -e exits non-zero exactly when the remote commit's tree lacks the file.
    onRemote = false
  }
  return { cycle: newest, recordOnRemote: onRemote }
}

/**
 * Build the running cycle's record from its step file and the checkout, and write it.
 * @param root - repository root: the cycle's checkout.
 * @param args - the cycle's flags.
 * @param now - the moment the record is built.
 * @returns the repository-relative file written and the record.
 * @throws when the step file or a commit cannot be read, the record is invalid, or a record for the cycle already exists.
 */
export function writeCycleRecord(root: string, args: CycleRecordArguments, now: Date): { file: string; record: CycleRecord } {
  const file = `${CYCLES_DIR}/${args.cycle}.json`
  if (existsSync(join(root, file))) throw new Error(`enterprise-cycle-record: ${file} already exists; a cycle writes its record once`)
  const ledgerFile = join(root, LEDGER_PATH)
  const record = buildCycleRecord({
    cycle: args.cycle,
    endedAt: now.toISOString(),
    commits: { start: args.start, pulled: args.pulled, end: git(root, ['rev-parse', 'HEAD']) },
    steps: parseStepLines(readFileSync(args.steps, 'utf8')),
    ledgerBefore: git(root, ['show', `${args.pulled}:${LEDGER_PATH}`]),
    ledgerAfter: existsSync(ledgerFile) ? readFileSync(ledgerFile, 'utf8') : '',
    previous: previousRecord(root, args.cycle, args.remote),
  })
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), `${JSON.stringify(record, null, 2)}\n`)
  return { file, record }
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const { file, record } = writeCycleRecord(root, parseCycleRecordArguments(process.argv.slice(2)), new Date())
  const failure = record.firstFailure === null ? 'every step exited 0' : `first failure ${record.firstFailure.step} exit=${record.firstFailure.exit}`
  console.log([
    `enterprise-cycle-record: wrote ${file}: ${record.steps.length} steps, ${failure};`,
    `shifts ${record.shifts.length === 0 ? 'none' : record.shifts.join(', ')};`,
    `tickets ${record.tickets.shipped} shipped, ${record.tickets.rejected} rejected, ${record.tickets.halted} halted;`,
    `functions ${record.functions.pass} pass, ${record.functions.fail} fail, ${record.functions.error} error`,
    record.previous === null ? '' : `; previous ${record.previous.cycle} on the remote: ${record.previous.recordOnRemote ?? 'unknown'}`,
  ].join(' '))
}
