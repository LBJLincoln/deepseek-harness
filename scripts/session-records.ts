/**
 * Reads recorded session logs: where a run directory keeps its session files,
 * how one `session.jsonl` line decodes, and the facts one session file states
 * about itself. `scripts/harness-feed.ts` reads live and committed runs through
 * this module, and `scripts/enterprise-roster.ts` reads the committed records
 * through it, so the feed and the roster file fold a session file identically.
 *
 * Session logs are JSON from durable files, one of this repository's named
 * validation boundaries: every reader here tolerates a missing path, an
 * unreadable directory, a torn line, and a field of an unexpected type, and
 * none of them throws.
 *
 * @module session-records
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** The committed Proving Ground records, relative to the repository root. */
export const PROVING_GROUND_RECORDS = 'data/proving-ground'

/** The committed code-safety review records, relative to the repository root. */
export const CODE_SAFETY_RECORDS = 'data/code-safety'

/**
 * Known session-log subdirectory names: a recorded `data/proving-ground/<id>`
 * or `data/code-safety/<id>` run uses `sessions`; a live
 * `.proving-ground/runs/<id>` or `.code-safety/<id>` run uses the dot-prefixed
 * `.sessions`. A run directory also holds non-session JSONL records at its top
 * level (`facts.jsonl`, `trajectories.jsonl`), which carry none of a session
 * line's fields; scoping the search to the known subdirectory keeps them out.
 */
const SESSION_SUBDIRS = ['sessions', '.sessions'] as const

/**
 * One decoded `session.jsonl` line. `type` is read as `unknown`, not `string`:
 * a run directory's JSONL files include lines this module does not own (a
 * session's header line, and a stray non-session record when a layout
 * {@link sessionFilesIn} does not recognize falls back to scanning a whole run
 * directory) whose `type` is absent or not a string. Every reader goes through
 * {@link typeOf} rather than assuming the field, so such a line is skipped,
 * never thrown on.
 */
export interface SessionLine {
  type?: unknown
  seq?: number
  time?: number
  data?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * @param line - one decoded line.
 * @returns `line.type` when it decoded as a string, else `undefined`; see {@link SessionLine}.
 */
export function typeOf(line: SessionLine): string | undefined {
  return typeof line.type === 'string' ? line.type : undefined
}

/**
 * @param header - a session's `session` header line, when it has one.
 * @param fallback - the id to answer when the header carries no string `id` (typically the file's path).
 * @returns the session id.
 */
function sessionIdOf(header: SessionLine | undefined, fallback: string): string {
  return typeof header?.id === 'string' ? header.id : fallback
}

/**
 * @param path - directory to list.
 * @returns directory entry names, or `[]` for a missing or unreadable directory.
 */
export function listDirSafe(path: string): string[] {
  if (!existsSync(path)) return []
  try {
    return readdirSync(path)
  } catch {
    // Unreadable directory (permissions, or removed between existsSync and
    // readdirSync) — treated as empty rather than failing discovery.
    return []
  }
}

/**
 * @param path - path to test.
 * @returns whether `path` is a directory, tolerating a missing or unreadable path.
 */
export function statSafeIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    // Missing or unreadable: not a directory this module can read.
    return false
  }
}

/**
 * @param dir - directory to search.
 * @returns every `*.jsonl` file under `dir` (recursively, unbounded depth), sorted for stable ordering.
 */
function findJsonlFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) break
    for (const name of listDirSafe(current)) {
      const full = join(current, name)
      if (statSafeIsDirectory(full)) stack.push(full)
      else if (name.endsWith('.jsonl')) out.push(full)
    }
  }
  return out.sort()
}

/**
 * @param runDir - absolute path of one run directory.
 * @returns every `*.jsonl` file under the run's session subdirectory (see
 *   {@link SESSION_SUBDIRS}), or under the run directory itself when neither
 *   known subdirectory exists (a layout this module does not recognize,
 *   tolerated rather than reporting no sessions at all).
 */
export function sessionFilesIn(runDir: string): string[] {
  for (const subdir of SESSION_SUBDIRS) {
    const candidate = join(runDir, subdir)
    if (statSafeIsDirectory(candidate)) return findJsonlFiles(candidate)
  }
  return findJsonlFiles(runDir)
}

/**
 * The record directories under one committed record tree.
 * @param root - the directory the tree is relative to (the repository root, or a feed's fixtures directory).
 * @param tree - the record tree, such as {@link PROVING_GROUND_RECORDS}.
 * @returns the name of every directory under the tree that holds a `sessions` directory, sorted.
 */
export function recordIds(root: string, tree: string): string[] {
  const base = join(root, tree)
  return listDirSafe(base)
    .sort()
    .filter(id => statSafeIsDirectory(join(base, id)) && statSafeIsDirectory(join(base, id, 'sessions')))
}

/**
 * Parse a `session.jsonl` file line by line. A line that fails to parse is
 * skipped, never thrown: the file may be mid-write by a live process.
 * @param file - absolute path to the JSONL file.
 * @returns the successfully parsed lines, in file order.
 */
export function readJsonlLines(file: string): SessionLine[] {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    // Removed or unreadable since discovery: the file contributes no lines.
    return []
  }
  const lines: SessionLine[] = []
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim()
    if (trimmed.length === 0) continue
    try {
      lines.push(JSON.parse(trimmed) as SessionLine)
    } catch {
      // One malformed row (a torn write at the tail of a live file) does not
      // invalidate the rest of the log.
      continue
    }
  }
  return lines
}

/** What one session file states about itself, read by {@link foldSessionFacts}. */
export interface SessionFacts {
  /** The header's `id`; the fallback the caller names when the header carries none. */
  sessionId: string
  /** The header's `parentSession`: the session that delegated this one. */
  parentSessionId?: string
  /** `environmentId` of the first `environment/run` event (`code:lex-states`): the bench environment the session ran. */
  environmentId?: string
  /** Provider route key the first `request/header` stamped; absent when the session made no model request. */
  route?: string
  /** Epoch milliseconds of the newest line carrying a `time`, else the header's `createdAt`. */
  lastSeenMs?: number
  /** Whether the session logged a `verification/certificate` event. */
  certified: boolean
  /** `step/start` events: the steps the session's agent took. */
  steps: number
  /** `tool/call` events: the tool calls the session's agent made. */
  toolCalls: number
}

/**
 * Fold one session file's decoded lines into the facts it states about itself.
 * Steps, tool calls and certification are counted the way
 * `data/code-safety/tools/trajectory.mjs` counts them for a record's
 * provenance, so the feed's program ledger and that tool agree.
 * @param lines - the file's decoded lines, in file order.
 * @param fallbackId - the session id to use when the header carries none.
 * @returns the session's facts.
 */
export function foldSessionFacts(lines: readonly SessionLine[], fallbackId: string): SessionFacts {
  const header = lines.find(line => typeOf(line) === 'session')
  const request = lines.find(line => typeOf(line) === 'request/header')
  const environment = lines.find(line => typeOf(line) === 'environment/run')
  let lastSeenMs = typeof header?.createdAt === 'number' ? header.createdAt : undefined
  let steps = 0
  let toolCalls = 0
  let certified = false
  for (const line of lines) {
    if (typeof line.time === 'number' && (lastSeenMs === undefined || line.time > lastSeenMs)) lastSeenMs = line.time
    const type = typeOf(line)
    if (type === 'step/start') steps += 1
    else if (type === 'tool/call') toolCalls += 1
    else if (type?.startsWith('verification/certificate') === true) certified = true
  }
  const parentSessionId = header?.parentSession
  const environmentId = environment?.data?.environmentId
  const route = (request?.data?.header as { config?: { provider?: unknown } } | undefined)?.config?.provider
  return {
    sessionId: sessionIdOf(header, fallbackId),
    ...typeof parentSessionId === 'string' ? { parentSessionId } : {},
    ...typeof environmentId === 'string' ? { environmentId } : {},
    ...typeof route === 'string' ? { route } : {},
    ...lastSeenMs === undefined ? {} : { lastSeenMs },
    certified,
    steps,
    toolCalls,
  }
}
