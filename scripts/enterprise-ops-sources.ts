/**
 * The readers behind the operations snapshot (`scripts/enterprise-ops.ts`):
 * one parser per activity source of the enterprise's machine, each a pure
 * function over the text or JSON the source writes, plus the few readers that
 * touch the host itself (`/proc`, `statfs`).
 *
 * Every source here is a durable file or a process table written by another
 * program, so each parser tolerates a torn line, a missing field and a field
 * of the wrong type, and none of them throws: a source that cannot be read at
 * all is reported by the caller as `unknown`, and nothing is inferred for it.
 *
 * @module enterprise-ops-sources
 */

import { closeSync, openSync, readdirSync, readFileSync, readSync, statfsSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

import type { EventKind } from '../apps/command-deck/deck/contract.ts'
import { SECRET_PATTERN_NAMES, redactText } from '../data/transcripts/tools/secret-patterns.mjs'
import type { SessionLine } from './session-records.ts'

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** How long one `doing` line may run before it is cut. */
const DOING_MAX = 96

/**
 * Credential-shaped strings a tool description or command may carry: provider
 * key prefixes, bearer tokens, JWTs, `key=value` assignments of secret-named
 * variables, and any unbroken run of 32 or more key characters.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:sk|pk|rk)-[\w-]{8,}/g,
  /\b(?:ghp|gho|ghs|ghu|github_pat)_[\w]{8,}/g,
  /\bxox[abprs]-[\w-]{8,}/g,
  /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{4,}/g,
  /\bBearer\s+\S+/gi,
  /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY)[A-Z0-9_]*)=\S+/gi,
  /[A-Za-z0-9+/_-]{32,}={0,2}/g,
]

/**
 * One line of text safe to publish: whitespace collapsed, every credential
 * shape and e-mail address of the shared transcript redaction
 * (`data/transcripts/tools/secret-patterns.mjs`) replaced by its marker, this
 * module's wider shapes by `…`,
 * absolute paths under a home or temporary directory cut to their last
 * segment, and the result cut to `max` characters.
 * @param text - Any text an agent logged.
 * @param max - The longest line kept.
 * @returns The line.
 */
export function publicLine(text: string, max = DOING_MAX): string {
  let line = redactText(text, SECRET_PATTERN_NAMES).text
  line = line.replaceAll(/\s+/g, ' ').trim()
  line = line.replaceAll(/(?:\/(?:home|root|tmp|Users)\/)[^\s'"`)]+/g, path => basename(path))
  for (const pattern of SECRET_PATTERNS) line = line.replaceAll(pattern, (match, name: unknown) => (typeof name === 'string' && match.includes('=') ? `${name}=…` : '…'))
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/**
 * The directory name Claude Code keeps a working directory's transcripts
 * under: the absolute path with every character outside `[A-Za-z0-9]`
 * replaced by `-`.
 * @param path - An absolute directory path.
 * @returns The project directory's name.
 */
export function claudeProjectName(path: string): string {
  return path.replaceAll(/[^A-Za-z0-9]/g, '-')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * @param value - An ISO time or anything else.
 * @returns Epoch milliseconds, or `undefined` when the value is not a parseable time.
 */
export function msOf(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? undefined : ms
}

/**
 * What one tool call was doing, as one publishable line: the tool's own
 * `description` argument when it gave one (a shell call's), else the tool name
 * with the last segment of the path or pattern it was given.
 * @param name - The tool's name.
 * @param input - The call's arguments, decoded.
 * @returns The line.
 */
export function describeToolCall(name: string, input: unknown): string {
  const args = isRecord(input) ? input : {}
  const description = stringOf(args.description)
  if (description !== undefined) return publicLine(`${name}: ${description}`)
  const target = [args.file_path, args.path, args.notebook_path, args.pattern, args.url].map(stringOf).find(value => value !== undefined)
  return publicLine(target === undefined ? name : `${name} ${basename(target)}`)
}

// ---------------------------------------------------------------------------
// Activity frames
// ---------------------------------------------------------------------------

/** One unit of observed work, before it is stamped with its agent's id: a {@link RunEvent} without `sessionId`. */
export interface Frame {
  ts: number
  seq: number
  kind: EventKind
  label: string
}

// ---------------------------------------------------------------------------
// Harness session logs (`session.jsonl`)
// ---------------------------------------------------------------------------

/** What one harness session log states about the agent that wrote it. */
export interface HarnessSessionFacts {
  sessionId: string
  /** Epoch milliseconds of the header's `createdAt`, else of the first event. */
  createdAt?: number
  /** Epoch milliseconds of the newest event. */
  lastAt?: number
  /** The newest tool call or step, as one publishable line. */
  doing?: string
  /** Input, output, cache-read and cache-write tokens summed over the session's usage chunks. */
  tokens: number
  /** A goal the session worked was completed or abandoned: the session will log no more work. */
  goalEnded: boolean
  /** The session's newest event ends a turn. */
  turnEnded: boolean
  /** The session logged a verification certificate. */
  certified: boolean
  frames: Frame[]
}

/** `goal/change` operations after which a session works no more on its goal, with the line each one reads as. */
const TERMINAL_GOAL_OPERATIONS: ReadonlyMap<string, string> = new Map([
  ['complete', 'goal completed'],
  ['abandon', 'goal abandoned'],
  ['cancel', 'goal cancelled'],
  ['fail', 'goal failed'],
])

/**
 * One tool call's arguments: a harness `tool/call` carries them as a JSON
 * string, which is decoded here and read as nothing when it does not decode.
 * @param raw - The `arguments` field.
 * @returns The decoded arguments.
 */
function toolArguments(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw) as unknown
  } catch {
    // A truncated argument string: the call is still named, without its target.
    return undefined
  }
}

/**
 * Fold one harness session log.
 * @param lines - The decoded lines, header first.
 * @param fallbackId - The id used when the header carries none.
 * @returns What the log states.
 */
export function foldHarnessSession(lines: readonly SessionLine[], fallbackId: string): HarnessSessionFacts {
  const facts: HarnessSessionFacts = { sessionId: fallbackId, tokens: 0, goalEnded: false, turnEnded: false, certified: false, frames: [] }
  for (const line of lines) {
    if (line.type === 'session') {
      facts.sessionId = stringOf(line.id) ?? facts.sessionId
      const created = numberOf(line.createdAt)
      if (created !== undefined) facts.createdAt = created
      continue
    }
    const type = typeof line.type === 'string' ? line.type : undefined
    const time = numberOf(line.time)
    if (type === undefined || time === undefined) continue
    facts.createdAt ??= time
    if (facts.lastAt === undefined || time > facts.lastAt) facts.lastAt = time
    facts.turnEnded = type === 'turn/end'
    const data = isRecord(line.data) ? line.data : {}
    const seq = (numberOf(line.seq) ?? facts.frames.length) + 1
    switch (type) {
      case 'tool/call': {
        const name = stringOf(data.name) ?? 'tool'
        facts.doing = describeToolCall(name, toolArguments(data.arguments))
        facts.frames.push({ ts: time, seq, kind: 'tool', label: facts.doing })
        break
      }
      case 'assistant/chunk': {
        const chunk = isRecord(data.chunk) ? data.chunk : {}
        const usage = chunk.type === 'usage' && isRecord(chunk.usage) ? chunk.usage : undefined
        if (usage !== undefined) {
          facts.tokens += (numberOf(usage.inputTokens) ?? 0) + (numberOf(usage.outputTokens) ?? 0)
            + (numberOf(usage.cacheReadTokens) ?? 0) + (numberOf(usage.cacheWriteTokens) ?? 0)
        }
        break
      }
      case 'turn/start':
        facts.doing = 'starting a turn'
        facts.frames.push({ ts: time, seq, kind: 'step', label: facts.doing })
        break
      case 'verification/run':
        facts.doing = 'running its acceptance checks'
        facts.frames.push({ ts: time, seq, kind: 'step', label: facts.doing })
        break
      case 'verification/directive':
        facts.doing = 'answering a failed acceptance check'
        facts.frames.push({ ts: time, seq, kind: 'directive', label: facts.doing })
        break
      case 'verification/certificate':
        facts.certified = true
        facts.doing = 'certified'
        facts.frames.push({ ts: time, seq, kind: 'certificate', label: 'certified' })
        break
      case 'goal/change': {
        const operation = stringOf(data.operation)
        const ended = operation === undefined ? undefined : TERMINAL_GOAL_OPERATIONS.get(operation)
        if (ended !== undefined) {
          facts.goalEnded = true
          facts.doing = ended
          facts.frames.push({ ts: time, seq, kind: operation === 'complete' ? 'merge' : 'refusal', label: ended })
        }
        break
      }
      default:
        break
    }
  }
  return facts
}

/**
 * Parse a JSONL text into lines, skipping a torn or undecodable row.
 * @param text - The file's content.
 * @returns The decoded lines.
 */
export function parseJsonl(text: string): SessionLine[] {
  const lines: SessionLine[] = []
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim()
    if (trimmed.length === 0) continue
    try {
      const value = JSON.parse(trimmed) as unknown
      if (isRecord(value)) lines.push(value)
    } catch {
      // A torn write at the tail of a live file: the rest still counts.
      continue
    }
  }
  return lines
}

// ---------------------------------------------------------------------------
// Claude Code transcripts
// ---------------------------------------------------------------------------

/** How many recent frames one transcript keeps between incremental reads. */
const TRANSCRIPT_FRAMES = 40

/**
 * What the transcript folds have read of one Claude Code transcript so far.
 * The fold is incremental: it resumes at `offset`, the byte after the last
 * complete line it read, so a transcript that grows by megabytes an hour is
 * read once.
 */
export interface TranscriptState {
  offset: number
  /** Complete lines read so far: the next line's `seq` is `lines + 1`. */
  lines: number
  /** Tokens summed over the distinct assistant messages read so far. */
  tokens: number
  /** The newest assistant message id counted, so a message split across reads is counted once. */
  lastMessageId?: string
  firstAt?: number
  lastAt?: number
  doing?: string
  /**
   * The agent's turn is over: the newest assistant row stopped at the end of its
   * turn, or, in a streamed transcript whose rows carry no stop reason, is text
   * with no tool call after it and no user row since.
   */
  endedTurn: boolean
  frames: Frame[]
}

/** @returns The state of a transcript nothing has been read of. */
export function emptyTranscript(): TranscriptState {
  return { offset: 0, lines: 0, tokens: 0, endedTurn: false, frames: [] }
}

/**
 * Fold the complete lines of a transcript chunk into its state.
 * @param state - The state after the previous chunk; it is not mutated.
 * @param chunk - The bytes after `state.offset`, decoded; an incomplete last line is left for the next read.
 * @returns The new state.
 */
export function foldTranscript(state: TranscriptState, chunk: string): TranscriptState {
  const end = chunk.lastIndexOf('\n')
  if (end === -1) return state
  const next: TranscriptState = { ...state, frames: [...state.frames], offset: state.offset + Buffer.byteLength(chunk.slice(0, end + 1)) }
  const seen = new Set<string>(state.lastMessageId === undefined ? [] : [state.lastMessageId])
  for (const raw of chunk.slice(0, end).split('\n')) {
    next.lines += 1
    let entry: unknown
    try {
      entry = JSON.parse(raw)
    } catch {
      // A torn or blank row: it still occupies a line number.
      continue
    }
    if (!isRecord(entry)) continue
    const at = msOf(entry.timestamp)
    if (at !== undefined) {
      next.firstAt ??= at
      if (next.lastAt === undefined || at > next.lastAt) next.lastAt = at
    }
    const message = isRecord(entry.message) ? entry.message : undefined
    // A user row, a prompt or a tool result, reopens the turn the agent had ended.
    if (entry.type === 'user') next.endedTurn = false
    if (entry.type !== 'assistant' || message === undefined) continue
    const id = stringOf(message.id)
    if (id !== undefined && !seen.has(id)) {
      seen.add(id)
      next.lastMessageId = id
      const usage = isRecord(message.usage) ? message.usage : {}
      next.tokens += (numberOf(usage.input_tokens) ?? 0) + (numberOf(usage.output_tokens) ?? 0)
        + (numberOf(usage.cache_read_input_tokens) ?? 0) + (numberOf(usage.cache_creation_input_tokens) ?? 0)
    }
    const stop = stringOf(message.stop_reason)
    const content = Array.isArray(message.content) ? message.content : []
    // A streamed transcript records each block of a message as its own row with
    // no stop reason, so a row of text is the turn's end until a tool call or a
    // user row follows it: an agent whose last row is its final report is finished.
    if (stop !== undefined) next.endedTurn = stop === 'end_turn'
    else if (content.some(block => isRecord(block) && block.type === 'text')) next.endedTurn = true
    for (const block of content) {
      if (!isRecord(block) || block.type !== 'tool_use') continue
      next.endedTurn = false
      next.doing = describeToolCall(stringOf(block.name) ?? 'tool', block.input)
      if (at !== undefined) next.frames.push({ ts: at, seq: next.lines, kind: 'tool', label: next.doing })
    }
  }
  if (next.frames.length > TRANSCRIPT_FRAMES) next.frames = next.frames.slice(-TRANSCRIPT_FRAMES)
  return next
}

/**
 * Read a transcript's bytes after `offset`.
 * @param file - The transcript.
 * @param offset - Where the previous read stopped.
 * @returns The decoded bytes, or `undefined` when the file is unreadable or shorter than `offset` (rewritten).
 */
export function readFrom(file: string, offset: number): string | undefined {
  let size: number
  try {
    size = statSync(file).size
  } catch {
    // Removed since it was listed: the caller reports the transcript as unread.
    return undefined
  }
  if (size < offset) return undefined
  if (size === offset) return ''
  const fd = openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(size - offset)
    readSync(fd, buffer, 0, buffer.length, offset)
    return buffer.toString('utf8')
  } finally {
    closeSync(fd)
  }
}

// ---------------------------------------------------------------------------
// Enterprise cycle logs
// ---------------------------------------------------------------------------

/** One `enterprise-cycle: <cycle> <step> exit=<n> at <time>` line; the time is an ISO instant, or a clock time in older logs. */
interface CycleStep {
  step: string
  exit: number
  /** ISO time, dated by the log's own start. */
  at: string
}

/** What one cycle log states. */
export interface CycleLog {
  /** The log's file name. */
  file: string
  /** The cycle's id, from its step lines; absent before its first step is logged. */
  cycle?: string
  /** The log's start, from the stamp its file name carries. */
  startedAt: string
  steps: CycleStep[]
  /** The shift the cycle started, from the engine's `enterprise: shift <id>` line. */
  shift?: string
  /** The cycle's closing line: its first failing step's exit code, 0 when every step passed. */
  done?: { firstFailure: number }
  /** Why the cycle refused to run, when it did. */
  refused?: string
}

/** The cycle's steps in the order `scripts/enterprise-cycle.sh` runs them. */
const CYCLE_STEPS = ['pull', 'intake', 'intake-push', 'shift', 'pull-after-shift', 'functions', 'roster', 'publish', 'record', 'push'] as const

const STEP_LINE = /^enterprise-cycle: (cycle-\d{8}T\d{6}Z) ([\w-]+) exit=(\d+) at (?:(\d{4}-\d{2}-\d{2})T)?(\d{2}):(\d{2}):(\d{2})Z/
const DONE_LINE = /^enterprise-cycle: (cycle-\d{8}T\d{6}Z) done, first failure exit=(\d+)/
const SHIFT_LINE = /^enterprise: shift (\d{6}-[0-9a-f]{4})\b/
const REFUSAL_LINE = /^enterprise-cycle: (another cycle holds the lock|the checkout has uncommitted changes)/

/**
 * The instant a compact UTC stamp names.
 * @param stamp - `YYYYMMDDTHHMMSSZ`.
 * @returns The ISO time, or `undefined` for anything else.
 */
function stampTime(stamp: string): string | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp)
  if (match === null) return undefined
  const [, year, month, day, hour, minute, second] = match
  const ms = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString()
}

/**
 * Parse one cycle log. A step line carries an ISO instant; one from an older
 * log carries only a clock time, which is dated by the log's start and rolls
 * to the next day when the clock goes backwards.
 * @param file - The log's file name, `cycle-<YYYYMMDDTHHMMSSZ>.log`.
 * @param text - Its content.
 * @returns The log, or `undefined` when the file name carries no stamp.
 */
export function parseCycleLog(file: string, text: string): CycleLog | undefined {
  const stamp = /^cycle-(\d{8}T\d{6}Z)\.log$/.exec(file)?.[1]
  const startedAt = stamp === undefined ? undefined : stampTime(stamp)
  if (startedAt === undefined) return undefined
  const log: CycleLog = { file, startedAt, steps: [] }
  let clock = Date.parse(startedAt)
  for (const raw of text.split('\n')) {
    const line = raw.replaceAll(/\u001b\[[0-9;]*m/g, '').trim()
    const step = STEP_LINE.exec(line)
    if (step !== null) {
      const [, cycle, name, exit, date, hour, minute, second] = step
      if (cycle !== undefined) log.cycle = cycle
      const day = new Date(clock)
      let at = date === undefined
        ? Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), Number(hour), Number(minute), Number(second))
        : Date.parse(`${date}T${hour}:${minute}:${second}Z`)
      if (date === undefined && at < clock - 60_000) at += 24 * 60 * 60 * 1000
      clock = at
      log.steps.push({ step: name ?? '', exit: Number(exit), at: new Date(at).toISOString() })
      continue
    }
    const done = DONE_LINE.exec(line)
    if (done !== null) {
      if (done[1] !== undefined) log.cycle = done[1]
      log.done = { firstFailure: Number(done[2]) }
      continue
    }
    const shift = SHIFT_LINE.exec(line)
    if (shift !== null) {
      if (shift[1] !== undefined) log.shift = shift[1]
      continue
    }
    const refused = REFUSAL_LINE.exec(line)
    if (refused?.[1] !== undefined) log.refused = refused[1]
  }
  return log
}

/**
 * The step a cycle is running now: the one after its newest logged step in
 * {@link CYCLE_STEPS}, with the shift skipped after an intake the usage limit
 * stopped (exit 3), as the cycle skips it.
 * @param log - A cycle log without its closing line.
 * @returns The step's name; for a step the order does not know, `after <step>`.
 */
export function currentCycleStep(log: CycleLog): string {
  const last = log.steps.at(-1)
  if (last === undefined) return CYCLE_STEPS[0]
  const index = CYCLE_STEPS.indexOf(last.step as typeof CYCLE_STEPS[number])
  if (index === -1) return `after ${last.step}`
  const intake = log.steps.find(step => step.step === 'intake')
  let next = CYCLE_STEPS[index + 1]
  if (next === 'shift' && intake?.exit === 3) next = CYCLE_STEPS[index + 2]
  return next ?? `after ${last.step}`
}

/** What the scheduler's own log states. */
interface SchedulerLog {
  /** The newest `next cycle at` time it announced. */
  nextAt?: string
}

/**
 * Parse the scheduler's log.
 * @param text - Its content.
 * @returns The newest announced slot.
 */
export function parseSchedulerLog(text: string): SchedulerLog {
  const log: SchedulerLog = {}
  for (const line of text.split('\n')) {
    const next = /^enterprise-scheduler: next cycle at (\S+)/.exec(line.trim())
    const at = next?.[1] === undefined ? undefined : msOf(next[1])
    if (at !== undefined) log.nextAt = new Date(at).toISOString()
  }
  return log
}

/**
 * The cycles the branch history names: the enterprise's own commits carry
 * `chore(enterprise): <cycle> intake` and `… functions, roster and deck`, so
 * the history keeps every cycle after the machine's logs are gone.
 * @param log - `git log --format=%H%x09%cI%x09%s` output.
 * @returns Each cycle id with its first and newest commit times, ISO, and its newest commit.
 */
export function cyclesFromHistory(log: string): Map<string, { first: string; last: string; commit: string }> {
  const cycles = new Map<string, { first: string; last: string; commit: string }>()
  for (const line of log.split('\n')) {
    const [commit, at, subject] = line.split('\t')
    const cycle = /^chore\(enterprise\): (cycle-\d{8}T\d{6}Z)\b/.exec(subject ?? '')?.[1]
    const ms = msOf(at)
    if (cycle === undefined || ms === undefined || commit === undefined || !/^[0-9a-f]{40}$/.test(commit)) continue
    const iso = new Date(ms).toISOString()
    const known = cycles.get(cycle)
    if (known === undefined) cycles.set(cycle, { first: iso, last: iso, commit })
    else if (iso > known.last) cycles.set(cycle, { first: known.first, last: iso, commit })
    else if (iso < known.first) cycles.set(cycle, { ...known, first: iso })
  }
  return cycles
}

/**
 * The transcript capture's newest round the branch history names: each round
 * commits `chore(transcripts): live capture <UTC stamp>`.
 * @param log - `git log --format=%H%x09%cI%x09%s` output.
 * @returns The newest capture's stamp, else its commit time, epoch milliseconds; `undefined` when no capture is named.
 */
export function newestCapture(log: string): number | undefined {
  let newest: number | undefined
  for (const line of log.split('\n')) {
    const [, at, subject] = line.split('\t')
    const stamp = /^chore\(transcripts\): live capture (\S+)/.exec(subject ?? '')?.[1]
    if (stamp === undefined) continue
    const ms = msOf(stamp) ?? msOf(at)
    if (ms !== undefined && (newest === undefined || ms > newest)) newest = ms
  }
  return newest
}

// ---------------------------------------------------------------------------
// Branch CI (GitHub REST)
// ---------------------------------------------------------------------------

/** One Branch CI workflow run, as this module reads it. */
export interface CiRun {
  id: number
  sha: string
  status: string
  conclusion: string | null
  url: string
  createdAt: string
  updatedAt: string
}

/** One job of a run. */
export interface CiJob {
  name: string
  conclusion: string | null
  url: string
}

/**
 * Read a `GET /repos/:repo/actions/workflows/:file/runs` body.
 * @param body - The decoded body.
 * @returns The runs, newest first as listed; entries missing a field this module reads are left out.
 */
export function parseCiRuns(body: unknown): CiRun[] {
  if (!isRecord(body) || !Array.isArray(body.workflow_runs)) return []
  const runs: CiRun[] = []
  for (const entry of body.workflow_runs) {
    if (!isRecord(entry)) continue
    const id = numberOf(entry.id)
    const sha = stringOf(entry.head_sha)
    const url = stringOf(entry.html_url)
    const createdAt = stringOf(entry.created_at)
    if (id === undefined || sha === undefined || url === undefined || createdAt === undefined) continue
    runs.push({
      id,
      sha,
      status: stringOf(entry.status) ?? 'unknown',
      conclusion: stringOf(entry.conclusion) ?? null,
      url,
      createdAt,
      updatedAt: stringOf(entry.updated_at) ?? createdAt,
    })
  }
  return runs
}

/**
 * Read a `GET /repos/:repo/actions/runs/:id/jobs` body.
 * @param body - The decoded body.
 * @returns The jobs.
 */
export function parseCiJobs(body: unknown): CiJob[] {
  if (!isRecord(body) || !Array.isArray(body.jobs)) return []
  const jobs: CiJob[] = []
  for (const entry of body.jobs) {
    if (!isRecord(entry)) continue
    const name = stringOf(entry.name)
    const url = stringOf(entry.html_url)
    if (name === undefined || url === undefined) continue
    jobs.push({ name, conclusion: stringOf(entry.conclusion) ?? null, url })
  }
  return jobs
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

/** Memory as `/proc/meminfo` states it. */
export interface MemoryReading {
  availablePct: number
  swapUsedPct: number
}

/**
 * Parse `/proc/meminfo`.
 * @param text - Its content.
 * @returns Available memory and used swap as percentages, or `undefined` when a needed field is missing.
 */
export function parseMeminfo(text: string): MemoryReading | undefined {
  const field = (name: string): number | undefined => {
    const match = new RegExp(`^${name}:\\s+(\\d+)`, 'm').exec(text)
    return match === null ? undefined : Number(match[1])
  }
  const total = field('MemTotal')
  const available = field('MemAvailable')
  if (total === undefined || available === undefined || total === 0) return undefined
  const swapTotal = field('SwapTotal') ?? 0
  const swapFree = field('SwapFree') ?? swapTotal
  return {
    availablePct: round1((available / total) * 100),
    swapUsedPct: swapTotal === 0 ? 0 : round1(((swapTotal - swapFree) / swapTotal) * 100),
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * How full the filesystems under the given paths are, measured as `df`
 * measures capacity: used blocks over used plus available, so blocks reserved
 * for the superuser count as unavailable. Paths on one filesystem are reported once.
 * @param paths - Paths to measure.
 * @returns One reading per distinct filesystem; a path that cannot be measured is left out.
 */
export function diskUsage(paths: readonly string[]): { mount: string; usedPct: number; freeBytes: number }[] {
  const seen = new Set<string>()
  const out: { mount: string; usedPct: number; freeBytes: number }[] = []
  for (const path of paths) {
    let stats: ReturnType<typeof statfsSync>
    try {
      stats = statfsSync(path)
    } catch {
      // A path that does not exist on this machine is not a filesystem to report.
      continue
    }
    const key = `${stats.type}:${stats.blocks}:${stats.bsize}`
    if (seen.has(key)) continue
    seen.add(key)
    const used = stats.blocks - stats.bfree
    const denominator = used + stats.bavail
    if (denominator <= 0) continue
    out.push({ mount: path, usedPct: round1((used / denominator) * 100), freeBytes: stats.bavail * stats.bsize })
  }
  return out
}

/** One process in the process table. */
export interface ProcessInfo {
  pid: number
  ppid: number
  /** Its arguments joined by spaces. */
  cmdline: string
  /** Epoch milliseconds it started at. */
  startedAt: number
}

/**
 * Read the process table from `/proc`.
 * @param proc - The proc filesystem's mount point.
 * @param clockTicks - `sysconf(_SC_CLK_TCK)`, the unit of a process's start time.
 * @returns Every process that could be read, or `undefined` when `/proc` cannot be read at all.
 */
export function readProcesses(proc = '/proc', clockTicks = 100): ProcessInfo[] | undefined {
  let bootMs: number
  let entries: string[]
  try {
    const btime = /^btime (\d+)$/m.exec(readFileSync(join(proc, 'stat'), 'utf8'))?.[1]
    if (btime === undefined) return undefined
    bootMs = Number(btime) * 1000
    entries = readdirSync(proc).filter(name => /^\d+$/.test(name))
  } catch {
    // No /proc (another platform, or a sandbox that hides it): the caller reports processes as unknown.
    return undefined
  }
  const out: ProcessInfo[] = []
  for (const name of entries) {
    const info = readProcess(proc, name, bootMs, clockTicks)
    if (info !== undefined) out.push(info)
  }
  return out
}

/**
 * Read one `/proc/<pid>` entry.
 * @param proc - The proc mount point.
 * @param name - The pid directory's name.
 * @param bootMs - Boot time, epoch milliseconds.
 * @param clockTicks - Clock ticks per second.
 * @returns The process, or `undefined` when it exited while being read.
 */
function readProcess(proc: string, name: string, bootMs: number, clockTicks: number): ProcessInfo | undefined {
  try {
    const cmdline = readFileSync(join(proc, name, 'cmdline'), 'utf8').split('\0').filter(part => part.length > 0).join(' ')
    const stat = readFileSync(join(proc, name, 'stat'), 'utf8')
    // The command name in parentheses may itself hold spaces and parentheses; the fields after its last `)` are fixed.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    const ppid = Number(fields[1])
    const start = Number(fields[19])
    if (!Number.isFinite(ppid) || !Number.isFinite(start)) return undefined
    return { pid: Number(name), ppid, cmdline, startedAt: bootMs + ((start / clockTicks) * 1000) }
  } catch {
    // The process exited between the directory listing and this read.
    return undefined
  }
}
