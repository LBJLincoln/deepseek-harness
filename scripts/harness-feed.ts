#!/usr/bin/env node
/**
 * Zero-dependency HTTP + Server-Sent Events feed for the enterprise proof of
 * concept's front end. Serves the generated roster with live status overlaid
 * from real session data, discovers proving-ground and code-safety runs on
 * disk, folds a run's session logs into a normalized event stream, and starts
 * a code-safety scan as a detached child process.
 *
 * Every discovery path is a runtime output directory (`.proving-ground/runs`,
 * `data/proving-ground/*\/sessions`, `.code-safety`) that a fresh checkout does
 * not have; every handler tolerates all three being absent, and never treats
 * a malformed log line as fatal — see {@link readJsonlLines} and
 * {@link foldSessionEvent}. `--fixtures <dir>` substitutes a self-contained
 * directory (mirroring the same `.proving-ground/`, `data/proving-ground/`,
 * `.code-safety/` layout) for the real discovery roots, which is what lets
 * the front end's own tests run against fixed data; it never substitutes for
 * `data/enterprise/roster.json`, which always names the repository's real
 * generated roster.
 *
 * @module harness-feed
 */

import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Roster, RosterAgentDefinition } from './enterprise-roster.ts'

/** Default TCP port; overridden with `--port <n>`. */
export const DEFAULT_PORT = 4711

/** A discovered run's kind, named by which real or fixture directory produced it. */
export type RunKind = 'program' | 'fleet' | 'experiment' | 'code-safety'

/** A discovered run's lifecycle state, inferred from its plan/log/certificate data. */
export type RunStatus = 'running' | 'completed' | 'failed' | 'unknown'

/** The optional fields a `.proving-ground/runs/<id>/plan.json` may declare. */
interface PlanFile {
  kind?: string
  name?: string
  startedAt?: string
  endedAt?: string
  status?: string
}

/** The optional fields a `data/proving-ground/<id>/meta.json` may declare. */
interface RecordedRunMeta {
  name?: string
  startedAt?: string
  endedAt?: string
}

/** The optional fields a `.code-safety/<id>/target.json` may declare. */
interface TargetFile {
  name?: string
  path?: string
  startedAt?: string
}

/** One discovered run directory, from `.proving-ground/runs`, `data/proving-ground`, or `.code-safety`. */
export interface RunSummary {
  /** Run directory name. */
  id: string
  kind: RunKind
  name: string
  /** ISO timestamp; falls back to the run directory's own mtime when no log records one. */
  startedAt: string
  /** ISO timestamp; absent while the run has no recorded end. */
  endedAt?: string
  status: RunStatus
  /** Path to the run directory, relative to the discovery root. */
  path: string
}

/** The normalized kind an SSE event is folded into; see {@link foldSessionEvent}. */
export type FeedEventKind = 'step' | 'tool' | 'delegation' | 'directive' | 'certificate' | 'finding' | 'merge' | 'refusal'

/** Finding/certificate severity, matching the vocabulary `SafetyCertificate.counts` uses. */
export type FeedSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

/** One folded SSE event, sent as `data: <JSON>\n\n`. */
export interface FeedEvent {
  /** Epoch milliseconds, from the source event's own `time` when present. */
  ts: number
  /** The source event's sequence number within its session; used for SSE `id:` framing. */
  seq: number
  /** The roster agent this session maps to; see {@link mapSessionToAgentId}. */
  agentId: string
  sessionId: string
  kind: FeedEventKind
  label: string
  detail?: string
  severity?: FeedSeverity
  file?: string
  line?: number
}

/**
 * What {@link foldSessionEvent} can determine from one log line alone: every
 * {@link FeedEvent} field except `agentId`, which requires the whole session
 * (see {@link mapSessionToAgentId}) and is merged in by the caller.
 */
export type FoldedEvent = Omit<FeedEvent, 'agentId'>

/** One code-safety department's live review state. */
export interface SafetyDepartmentStatus {
  id: string
  name: string
  status: 'clean' | 'findings' | 'pending'
  certified: boolean
  findings: number
}

/** One finding row, passed through from the run's `findings.json` verbatim beyond normalization. */
export interface SafetyFinding {
  id?: string
  department?: string
  severity?: FeedSeverity
  file?: string
  line?: number
  message?: string
  [key: string]: unknown
}

/** The run's verifier output, normalized from `verifier.json` or its stdout capture. */
export interface SafetyCertificate {
  verified: boolean
  verifier: string
  checkedAt?: string
  counts: Record<FeedSeverity, number>
  /** Department ids the verifier could not check. */
  unverified: string[]
}

/** One target file the code-safety walk recorded. */
export interface SafetyTargetFile {
  path: string
  bytes: number
  language: string
}

/** The complete `/safety/:id` response. */
export interface SafetyDetail {
  target: {
    name: string
    path: string
    files: SafetyTargetFile[]
    languages: Record<string, number>
  }
  departments: SafetyDepartmentStatus[]
  findings: SafetyFinding[]
  certificate: SafetyCertificate
  report: { markdown: string }
}

/** A roster agent with live status computed from real session data, replacing the generated file's static `"defined"`. */
export type LiveRosterAgent = Omit<RosterAgentDefinition, 'status'> & { status: RosterAgentDefinition['status'] | 'active' | 'certified' | 'failed' }

/** The `/roster` response: the generated roster with live status and `counts.active` overlaid. */
export type LiveRoster = Omit<Roster, 'agents'> & { agents: LiveRosterAgent[] }

/** Tool names that register the subagent delegation capability; a call/result for one of these folds to `delegation`, not `tool`. */
const DELEGATION_TOOL_NAMES = new Set(['subagent', 'subagent_control', 'subagent_report'])

/** Case-insensitive phrases that mark a failed tool result as a policy refusal rather than an ordinary tool error. */
const REFUSAL_PATTERN = /denied|refused|blocked|not permitted|requires reading/i

const CODE_SAFETY_DEPARTMENTS: readonly { id: string; name: string }[] = [
  { id: 'secrets', name: 'Secrets' },
  { id: 'injection', name: 'Injection' },
  { id: 'access', name: 'Access' },
  { id: 'data', name: 'Data' },
  { id: 'dependencies', name: 'Dependencies' },
  { id: 'platform', name: 'Platform' },
]

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript',
  '.cjs': 'JavaScript', '.py': 'Python', '.java': 'Java', '.go': 'Go', '.php': 'PHP', '.swift': 'Swift',
  '.kt': 'Kotlin', '.kts': 'Kotlin', '.rb': 'Ruby', '.rs': 'Rust', '.c': 'C', '.h': 'C', '.cpp': 'C++',
  '.md': 'Markdown', '.json': 'JSON', '.yml': 'YAML', '.yaml': 'YAML',
}

const SKIPPED_WALK_DIRS = new Set(['node_modules', '.git'])
const MAX_WALK_FILES = 5_000

// ---------------------------------------------------------------------------
// Small, tolerant filesystem helpers. None of these throw on a missing or
// malformed path: absence and shape drift are the expected steady state for
// every discovery root this module reads (see the module doc).
// ---------------------------------------------------------------------------

/**
 * Read and parse one JSON file, or answer `undefined` for a missing file or
 * invalid JSON. Returns `unknown` rather than a caller-supplied type
 * parameter — `JSON.parse` output is exactly the untrusted-file boundary
 * this repository's conventions ask callers to narrow explicitly, so every
 * call site casts (`as Partial<Shape>`) instead of trusting an unchecked
 * generic.
 * @param path - absolute file path to read.
 * @returns the parsed value, or `undefined`.
 */
function readJsonSafe(path: string): unknown {
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    // Malformed JSON on disk (a run captured mid-write, or hand-edited) — the
    // caller falls back to its own default rather than failing the request.
    return undefined
  }
}

/** @returns directory entry names, or `[]` for a missing or unreadable directory. */
function listDirSafe(path: string): string[] {
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
 * Read one field from an untrusted `data` record as a string, falling back
 * when it is absent or not a string/number. Session-log `data` fields are
 * JSON from a durable file — one of this repository's named validation
 * boundaries — so this narrows explicitly rather than calling `String()` on
 * an `unknown` value, which would silently print `[object Object]` for a
 * shape this fold does not expect.
 * @param data - the decoded event's `data` record.
 * @param key - field to read.
 * @param fallback - value to use when the field is missing or not stringable.
 * @returns a string.
 */
function stringField(data: Record<string, unknown>, key: string, fallback: string): string {
  const value = data[key]
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback
}

/** @returns a session's header `id` when it decoded as a string, else `fallback` (typically its file path). */
function sessionIdOf(header: SessionLine | undefined, fallback: string): string {
  return typeof header?.id === 'string' ? header.id : fallback
}

/** @returns the entry's mtime as an ISO string, or `undefined` if it cannot be stat'd. */
function mtimeIso(path: string): string | undefined {
  try {
    return statSync(path).mtime.toISOString()
  } catch {
    return undefined
  }
}

/**
 * Recursively list files under `root`, skipping `node_modules`/`.git` and
 * capping the total at {@link MAX_WALK_FILES} so a large or symlink-cyclic
 * target cannot hang the request.
 * @param root - directory to walk.
 * @returns absolute file paths.
 */
function walkFiles(root: string): string[] {
  const out: string[] = []
  const stack = [root]
  while (stack.length > 0 && out.length < MAX_WALK_FILES) {
    const dir = stack.pop()
    if (dir === undefined) break
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (out.length >= MAX_WALK_FILES) break
      if (entry.isDirectory()) {
        if (!SKIPPED_WALK_DIRS.has(entry.name)) stack.push(join(dir, entry.name))
      } else if (entry.isFile()) {
        out.push(join(dir, entry.name))
      }
    }
  }
  return out
}

/** @returns every `*.jsonl` file under `dir` (recursively, unbounded depth), sorted for stable ordering. */
function findJsonlFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) break
    for (const name of listDirSafe(current)) {
      const full = join(current, name)
      let isDir = false
      try {
        isDir = statSync(full).isDirectory()
      } catch {
        continue
      }
      if (isDir) stack.push(full)
      else if (name.endsWith('.jsonl')) out.push(full)
    }
  }
  return out.sort()
}

// ---------------------------------------------------------------------------
// Run discovery
// ---------------------------------------------------------------------------

/**
 * One `.proving-ground/runs/<id>` fleet or experiment run: `plan.json` names
 * its kind/name/timestamps (all optional; absence falls back to a directory
 * stat and the `experiment` kind), and its sessions live under `.sessions`.
 */
function discoverProvingGroundRuns(discoveryRoot: string): RunSummary[] {
  const base = join(discoveryRoot, '.proving-ground/runs')
  const runs: RunSummary[] = []
  for (const id of listDirSafe(base).sort()) {
    const dir = join(base, id)
    if (!statSafeIsDirectory(dir)) continue
    const plan = readJsonSafe(join(dir, 'plan.json')) as PlanFile | undefined
    const kind: RunKind = plan?.kind === 'fleet' || plan?.kind === 'program' ? plan.kind : 'experiment'
    runs.push({
      id,
      kind,
      name: plan?.name ?? id,
      startedAt: plan?.startedAt ?? mtimeIso(dir) ?? new Date(0).toISOString(),
      endedAt: plan?.endedAt,
      status: resolveRunStatus(plan?.status, plan?.endedAt, dir),
      path: relative(discoveryRoot, dir),
    })
  }
  return runs
}

/**
 * One `data/proving-ground/<id>/sessions/*.jsonl` recorded, read-only run.
 * These are committed historical records, so a run with no explicit end
 * marker is still reported `completed` rather than `running`.
 */
function discoverRecordedProvingGroundRuns(discoveryRoot: string): RunSummary[] {
  const base = join(discoveryRoot, 'data/proving-ground')
  const runs: RunSummary[] = []
  for (const id of listDirSafe(base).sort()) {
    const dir = join(base, id)
    const sessionsDir = join(dir, 'sessions')
    if (!statSafeIsDirectory(dir) || !statSafeIsDirectory(sessionsDir)) continue
    const meta = readJsonSafe(join(dir, 'meta.json')) as RecordedRunMeta | undefined
    runs.push({
      id,
      kind: 'experiment',
      name: meta?.name ?? id,
      startedAt: meta?.startedAt ?? mtimeIso(dir) ?? new Date(0).toISOString(),
      endedAt: meta?.endedAt ?? mtimeIso(dir),
      status: 'completed',
      path: relative(discoveryRoot, dir),
    })
  }
  return runs
}

/**
 * One `.code-safety/<id>` scan run. Status follows `verifier.json` when
 * present (`verified: true` -> completed, `false` -> failed); with no
 * verifier yet, a run with findings recorded is `running`, and a wholly empty
 * one is `unknown` rather than guessed.
 */
function discoverCodeSafetyRuns(discoveryRoot: string): RunSummary[] {
  const base = join(discoveryRoot, '.code-safety')
  const runs: RunSummary[] = []
  for (const id of listDirSafe(base).sort()) {
    const dir = join(base, id)
    if (!statSafeIsDirectory(dir)) continue
    const target = readJsonSafe(join(dir, 'target.json')) as TargetFile | undefined
    const verifier = readVerifier(dir)
    const hasFindings = existsSync(join(dir, 'findings.json'))
    const status: RunStatus = verifier !== undefined
      ? (verifier.verified ? 'completed' : 'failed')
      : hasFindings ? 'running' : 'unknown'
    runs.push({
      id,
      kind: 'code-safety',
      name: target?.name ?? id,
      startedAt: target?.startedAt ?? mtimeIso(dir) ?? new Date(0).toISOString(),
      endedAt: verifier?.checkedAt,
      status,
      path: relative(discoveryRoot, dir),
    })
  }
  return runs
}

/** @returns whether `path` is a directory, tolerating a missing or unreadable path. */
function statSafeIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Reconcile an explicit `plan.json` status with the presence of an end timestamp. */
function resolveRunStatus(explicit: string | undefined, endedAt: string | undefined, dir: string): RunStatus {
  if (explicit === 'running' || explicit === 'completed' || explicit === 'failed') return explicit
  if (endedAt !== undefined) return 'completed'
  // No plan.json status and no endedAt: an active run.log growing under a
  // live process looks the same on disk as an abandoned one, so this reports
  // "running" and lets the caller re-poll rather than guessing "failed".
  return existsSync(join(dir, 'run.log')) ? 'running' : 'unknown'
}

/** Read and normalize `verifier.json`, or parse a trailing JSON object out of a plain-text verifier stdout capture. */
function readVerifier(runDir: string): SafetyCertificate | undefined {
  const structured = readJsonSafe(join(runDir, 'verifier.json')) as Partial<SafetyCertificate> | undefined
  if (structured !== undefined) return normalizeCertificate(structured)
  const stdoutPath = join(runDir, 'verifier.stdout.txt')
  if (!existsSync(stdoutPath)) return undefined
  const text = readFileSync(stdoutPath, 'utf8')
  const match = /\{[\s\S]*\}/.exec(text)
  if (match === null) return undefined
  try {
    return normalizeCertificate(JSON.parse(match[0]) as Partial<SafetyCertificate>)
  } catch {
    // The verifier's stdout does not end in a parseable JSON object (still
    // running, or a crash before it printed one) — no certificate yet.
    return undefined
  }
}

/** Fill in every {@link SafetyCertificate} field a partial verifier record left out. */
function normalizeCertificate(partial: Partial<SafetyCertificate>): SafetyCertificate {
  return {
    verified: partial.verified ?? false,
    verifier: partial.verifier ?? 'unknown',
    checkedAt: partial.checkedAt,
    counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0, ...partial.counts },
    unverified: partial.unverified ?? [],
  }
}

/**
 * Discover every run this feed knows how to find. `.proving-ground/runs`,
 * `data/proving-ground`, and `.code-safety` are independent and each may be
 * absent; a missing directory contributes no runs rather than an error.
 * @param discoveryRoot - the real repository root, or a `--fixtures` directory.
 * @returns every discovered run, newest first.
 */
export function discoverRuns(discoveryRoot: string): RunSummary[] {
  const runs = [
    ...discoverProvingGroundRuns(discoveryRoot),
    ...discoverRecordedProvingGroundRuns(discoveryRoot),
    ...discoverCodeSafetyRuns(discoveryRoot),
  ]
  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

/** @returns every `session.jsonl`-shaped file under one run's directory. */
export function sessionFilesForRun(discoveryRoot: string, run: RunSummary): string[] {
  return findJsonlFiles(join(discoveryRoot, run.path))
}

// ---------------------------------------------------------------------------
// Session log parsing and event folding
// ---------------------------------------------------------------------------

/** One decoded `session.jsonl` line; a header line has no `seq`. */
interface SessionLine {
  type: string
  seq?: number
  time?: number
  data?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * Parse a `session.jsonl` file line by line. A line that fails to parse is
 * skipped, never thrown — the file may be mid-write by a live process.
 * @param file - absolute path to the JSONL file.
 * @returns the successfully parsed lines, in file order.
 */
export function readJsonlLines(file: string): SessionLine[] {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
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

/** Mutable state threaded through one session file's fold, so a `tool/result` can recover its call's name. */
interface FoldState {
  sessionId: string
  callNameById: Map<string, string>
}

/** The fields this fold reads from a `tool/result` event's `data.message`. */
interface ToolResultMessage {
  source?: { callId?: string }
  content?: { isError?: boolean; content?: { text?: string }[] }[]
}

/**
 * Fold one decoded session-log line into a feed event, or `undefined` when
 * the line carries no product-visible event this stream reports (chunks,
 * usage, request headers, and any type this fold does not recognize).
 *
 * Recognizes both this repository's real session-event vocabulary
 * (`turn/*`, `step/*`, `tool/call`, `tool/result`, `agent/inbox/spliced`) and
 * the forward-looking prefixes the parallel proving-ground and code-safety
 * programs are expected to emit (`verification/certificate`,
 * `program/integration`, a `finding`-prefixed type), so no change is needed
 * here once those programs start writing real logs.
 * @param line - one decoded `session.jsonl` row.
 * @param state - per-file fold state (tool-call name correlation).
 * @returns the folded event (`agentId` not yet attached), or `undefined` to drop the line.
 */
export function foldSessionEvent(line: SessionLine, state: FoldState): FoldedEvent | undefined {
  const { type } = line
  const data = line.data ?? {}
  const base = { ts: line.time ?? 0, seq: line.seq ?? 0, sessionId: state.sessionId }

  if (type === 'turn/start') return { ...base, kind: 'step', label: `Turn ${stringField(data, 'turn', '?')} started` }
  if (type === 'turn/end') {
    const reason = (data.reason as { kind?: string } | undefined)?.kind
    return { ...base, kind: 'step', label: `Turn ${stringField(data, 'turn', '?')} ended`, detail: reason }
  }
  if (type === 'step/start') return { ...base, kind: 'step', label: `Step ${stringField(data, 'step', '?')} started` }
  if (type === 'step/end') return { ...base, kind: 'step', label: `Step ${stringField(data, 'step', '?')} ended` }
  if (type === 'agent/step') return { ...base, kind: 'step', label: stringField(data, 'label', 'agent step') }

  if (type === 'tool/call') {
    const name = stringField(data, 'name', 'tool')
    const callId = stringField(data, 'callId', '')
    if (callId.length > 0) state.callNameById.set(callId, name)
    return { ...base, kind: DELEGATION_TOOL_NAMES.has(name) ? 'delegation' : 'tool', label: name }
  }
  if (type === 'tool/result') {
    const message = data.message as ToolResultMessage | undefined
    const callId = message?.source?.callId ?? ''
    const name = state.callNameById.get(callId) ?? 'tool'
    const result = message?.content?.[0]
    const text = result?.content?.map(part => part.text).filter((value): value is string => value !== undefined).join(' ') ?? ''
    if (result?.isError === true && REFUSAL_PATTERN.test(text)) {
      return { ...base, kind: 'refusal', label: name, detail: text.slice(0, 500), severity: 'medium' }
    }
    return {
      ...base,
      kind: DELEGATION_TOOL_NAMES.has(name) ? 'delegation' : 'tool',
      label: name,
      detail: text.length > 0 ? text.slice(0, 500) : undefined,
      severity: result?.isError === true ? 'high' : undefined,
    }
  }
  if (type.startsWith('tool-workflow/') || type.startsWith('tool/code-dispatch')) {
    return { ...base, kind: 'tool', label: type.split('/')[0] === 'tool-workflow' ? 'workflow' : 'code-dispatch' }
  }

  if (type === 'agent/inbox/spliced' || type.startsWith('hook/')) {
    const inserted = data.inserted as { content?: { text?: string }[] }[] | undefined
    const preview = inserted?.[0]?.content?.[0]?.text
    return { ...base, kind: 'directive', label: 'directive queued', detail: preview?.slice(0, 200) }
  }

  if (type === 'verification/certificate' || type.startsWith('verification/certificate')) {
    return {
      ...base,
      kind: 'certificate',
      label: stringField(data, 'verifier', 'certificate'),
      detail: JSON.stringify(data).slice(0, 500),
    }
  }
  if (type === 'program/integration' || type.startsWith('program/integration')) {
    return { ...base, kind: 'merge', label: stringField(data, 'department', 'integration') }
  }
  if (type.startsWith('finding') || type === 'code-safety/finding') {
    return {
      ...base,
      kind: 'finding',
      label: stringField(data, 'message', stringField(data, 'rule', 'finding')),
      severity: data.severity as FeedSeverity | undefined,
      file: data.file as string | undefined,
      line: data.line as number | undefined,
    }
  }

  return undefined
}

/**
 * Best-effort mapping from one session's stamped request headers to a roster
 * agent: prefer an agent whose route matches the session's provider/model and
 * whose id or role appears in the system prompt text, then any agent on that
 * provider, then the division-level fallback named in `fallbackAgentId`.
 * @param lines - the session's decoded lines.
 * @param roster - the generated roster to map against.
 * @param fallbackAgentId - agent id to use when nothing else matches.
 * @returns a roster agent id.
 */
export function mapSessionToAgentId(lines: readonly SessionLine[], roster: Roster, fallbackAgentId: string): string {
  const header = lines.find(line => line.type === 'request/header')
  const config = (header?.data?.header as { config?: { provider?: string; model?: string }; system?: string } | undefined)
  const provider = config?.config?.provider
  const model = config?.config?.model
  const system = (config?.system ?? '').toLowerCase()
  const byProvider = provider === undefined ? [] : roster.agents.filter(agent => agent.route.provider === provider)
  const byModel = model === undefined ? byProvider : byProvider.filter(agent => agent.route.model === model)
  const pool = byModel.length > 0 ? byModel : byProvider
  const keywordMatch = pool.find(agent => system.includes(agent.role) || system.includes(agent.division))
  return keywordMatch?.id ?? pool[0]?.id ?? fallbackAgentId
}

// ---------------------------------------------------------------------------
// Roster liveness
// ---------------------------------------------------------------------------

/**
 * Overlay live status onto the generated roster: an agent is `active` when a
 * currently-running session maps to it, `certified` when a session that maps
 * to it logged a certificate event, and `failed` when a session mapped to it
 * ended without one. An agent with no matching session keeps `"defined"`.
 * @param roster - the generated static roster.
 * @param discoveryRoot - where to look for real or fixture run data.
 * @returns the roster with live status and `counts.active` overlaid.
 */
export function computeLiveRoster(roster: Roster, discoveryRoot: string): LiveRoster {
  const statusByAgent = new Map<string, 'active' | 'certified' | 'failed'>()
  const fallbackAgentId = roster.agents[0]?.id ?? ''
  for (const run of discoverRuns(discoveryRoot)) {
    for (const file of sessionFilesForRun(discoveryRoot, run)) {
      const lines = readJsonlLines(file)
      if (lines.length === 0) continue
      const header = lines.find(line => line.type === 'session')
      const sessionId = sessionIdOf(header, file)
      const agentId = mapSessionToAgentId(lines, roster, fallbackAgentId)
      const state: FoldState = { sessionId, callNameById: new Map() }
      const certified = lines.some(line => foldSessionEvent(line, state)?.kind === 'certificate')
      const next: 'active' | 'certified' | 'failed' = certified
        ? 'certified'
        : run.endedAt === undefined && run.status === 'running' ? 'active' : 'failed'
      // Precedence when several sessions map to the same agent: active (still
      // running right now) beats certified, which beats failed — the most
      // "alive" observation wins rather than the last one seen.
      const current = statusByAgent.get(agentId)
      if (current === 'active') continue
      if (current === 'certified' && next === 'failed') continue
      statusByAgent.set(agentId, next)
    }
  }
  const agents: LiveRosterAgent[] = roster.agents.map(agent => ({ ...agent, status: statusByAgent.get(agent.id) ?? agent.status }))
  const active = agents.filter(agent => agent.status === 'active').length
  return { ...roster, agents, counts: { ...roster.counts, active } }
}

// ---------------------------------------------------------------------------
// Code-safety detail
// ---------------------------------------------------------------------------

/** @returns the display language for one file path, by extension; `"Other"` when unrecognized. */
function languageForPath(path: string): string {
  return LANGUAGE_BY_EXTENSION[extname(path).toLowerCase()] ?? 'Other'
}

/**
 * Build the `/safety/:id` response from one `.code-safety/<id>` run
 * directory: walks the reviewed target for its file inventory, reads
 * `findings.json` and the verifier output, and folds both against the six
 * fixed code-safety departments so every department is reported even with
 * zero findings.
 * @param discoveryRoot - where the run directory lives.
 * @param id - the run id.
 * @returns the safety detail, or `undefined` when the run does not exist.
 */
export function buildSafetyDetail(discoveryRoot: string, id: string): SafetyDetail | undefined {
  const runDir = join(discoveryRoot, '.code-safety', id)
  if (!statSafeIsDirectory(runDir)) return undefined
  const targetMeta = readJsonSafe(join(runDir, 'target.json')) as TargetFile | undefined
  const targetPath = targetMeta?.path !== undefined && existsSync(targetMeta.path) ? targetMeta.path : runDir
  const files: SafetyTargetFile[] = walkFiles(targetPath).map((absolute) => {
    const path = relative(targetPath, absolute)
    const bytes = (() => {
      try {
        return statSync(absolute).size
      } catch {
        return 0
      }
    })()
    return { path, bytes, language: languageForPath(path) }
  })
  const languages: Record<string, number> = {}
  for (const file of files) languages[file.language] = (languages[file.language] ?? 0) + 1

  const findings = (readJsonSafe(join(runDir, 'findings.json')) as SafetyFinding[] | undefined) ?? []
  const certificate = readVerifier(runDir) ?? normalizeCertificate({})
  const departments: SafetyDepartmentStatus[] = CODE_SAFETY_DEPARTMENTS.map((department) => {
    const departmentFindings = findings.filter(finding => finding.department === department.id)
    const certified = certificate.verified && !certificate.unverified.includes(department.id)
    return {
      id: department.id,
      name: department.name,
      status: departmentFindings.length > 0 ? 'findings' : certificate.verified ? 'clean' : 'pending',
      certified,
      findings: departmentFindings.length,
    }
  })
  const report = { markdown: existsSync(join(runDir, 'SAFETY-REPORT.md')) ? readFileSync(join(runDir, 'SAFETY-REPORT.md'), 'utf8') : '' }

  return {
    target: { name: targetMeta?.name ?? id, path: targetPath, files, languages },
    departments,
    findings,
    certificate,
    report,
  }
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

/** Headers set on every response, including the SSE stream, so the front end can be served from a different origin. */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' })
  res.end(payload)
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message })
}

/** @returns the request body parsed as JSON, or `undefined` for an empty or invalid body. */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  } catch {
    return undefined
  }
}

/**
 * Stream one run's folded events over Server-Sent Events: replay every event
 * currently on disk, then poll each session file every 500ms for appended
 * lines until the client disconnects.
 * @param res - the open response to write SSE frames to.
 * @param discoveryRoot - where the run's session files live.
 * @param run - the run to stream.
 * @param roster - used to map each session to a roster agent.
 */
function streamRunEvents(res: ServerResponse, discoveryRoot: string, run: RunSummary, roster: Roster): void {
  res.writeHead(200, {
    ...CORS_HEADERS,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  const fallbackAgentId = roster.agents[0]?.id ?? ''
  const files = sessionFilesForRun(discoveryRoot, run)
  const offsetByFile = new Map<string, number>()
  const stateByFile = new Map<string, FoldState>()
  const agentIdByFile = new Map<string, string>()

  const send = (event: FoldedEvent, agentId: string): void => {
    res.write(`id: ${event.seq}\ndata: ${JSON.stringify({ ...event, agentId })}\n\n`)
  }

  for (const file of files) {
    const lines = readJsonlLines(file)
    const header = lines.find(line => line.type === 'session')
    const state: FoldState = { sessionId: sessionIdOf(header, file), callNameById: new Map() }
    stateByFile.set(file, state)
    const agentId = mapSessionToAgentId(lines, roster, fallbackAgentId)
    agentIdByFile.set(file, agentId)
    for (const line of lines) {
      const event = foldSessionEvent(line, state)
      if (event !== undefined) send(event, agentId)
    }
    try {
      offsetByFile.set(file, statSync(file).size)
    } catch {
      offsetByFile.set(file, 0)
    }
  }

  const poll = setInterval(() => {
    for (const file of files) {
      let size: number
      try {
        size = statSync(file).size
      } catch {
        continue
      }
      const lastOffset = offsetByFile.get(file) ?? 0
      if (size <= lastOffset) continue
      let appended: string
      try {
        appended = readFileSync(file, 'utf8').slice(lastOffset)
      } catch {
        continue
      }
      offsetByFile.set(file, size)
      const state = stateByFile.get(file) ?? { sessionId: file, callNameById: new Map() }
      const agentId = agentIdByFile.get(file) ?? fallbackAgentId
      for (const raw of appended.split('\n')) {
        const trimmed = raw.trim()
        if (trimmed.length === 0) continue
        let parsed: SessionLine
        try {
          parsed = JSON.parse(trimmed) as SessionLine
        } catch {
          continue
        }
        const event = foldSessionEvent(parsed, state)
        if (event !== undefined) send(event, agentId)
      }
    }
  }, 500)

  res.on('close', () => { clearInterval(poll) })
}

/** Options accepted by {@link createHarnessFeedServer}. */
export interface HarnessFeedOptions {
  /** Repository root; `data/enterprise/roster.json` always loads from here. */
  root: string
  /** When set, run/session/safety discovery reads this directory instead of `root`. */
  fixturesDir?: string
}

/**
 * Build the feed's HTTP server without starting it, so tests can `.listen(0)`
 * on an ephemeral port.
 * @param options - repository root and optional fixtures override.
 * @returns an unstarted `http.Server`.
 */
export function createHarnessFeedServer(options: HarnessFeedOptions): Server {
  const { root } = options
  const discoveryRoot = options.fixturesDir ?? root

  const loadRoster = (): Roster => {
    const raw = readFileSync(join(root, 'data/enterprise/roster.json'), 'utf8')
    return JSON.parse(raw) as Roster
  }

  return createServer((req, res) => {
    void handleRequest(req, res).catch((error: unknown) => {
      if (!res.headersSent) sendError(res, 500, error instanceof Error ? error.message : String(error))
    })
  })

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS)
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const { pathname } = url

    if (req.method === 'GET' && pathname === '/roster') {
      sendJson(res, 200, computeLiveRoster(loadRoster(), discoveryRoot))
      return
    }
    if (req.method === 'GET' && pathname === '/runs') {
      sendJson(res, 200, discoverRuns(discoveryRoot))
      return
    }
    const eventsMatch = /^\/runs\/([^/]+)\/events$/.exec(pathname)
    if (req.method === 'GET' && eventsMatch !== null) {
      const run = discoverRuns(discoveryRoot).find(candidate => candidate.id === eventsMatch[1])
      if (run === undefined) {
        sendError(res, 404, `no run "${eventsMatch[1]}"`)
        return
      }
      streamRunEvents(res, discoveryRoot, run, loadRoster())
      return
    }
    const safetyMatch = /^\/safety\/([^/]+)$/.exec(pathname)
    const safetyId = safetyMatch?.[1]
    if (req.method === 'GET' && safetyId !== undefined) {
      const detail = buildSafetyDetail(discoveryRoot, safetyId)
      if (detail === undefined) {
        sendError(res, 404, `no code-safety run "${safetyId}"`)
        return
      }
      sendJson(res, 200, detail)
      return
    }
    if (req.method === 'POST' && pathname === '/safety') {
      await handleStartSafety(req, res, root)
      return
    }
    sendError(res, 404, `no route for ${req.method ?? 'GET'} ${pathname}`)
  }
}

/** Whether `package.json` at `root` declares a `code-safety` script; the parallel workstream adds it, not this change. */
function hasCodeSafetyScript(root: string): boolean {
  const pkg = readJsonSafe(join(root, 'package.json')) as { scripts?: Record<string, string> } | undefined
  return typeof pkg?.scripts?.['code-safety'] === 'string'
}

async function handleStartSafety(req: IncomingMessage, res: ServerResponse, root: string): Promise<void> {
  if (!hasCodeSafetyScript(root)) {
    sendError(res, 501, 'pnpm run code-safety is not defined yet; the code-safety scanner ships in a parallel change')
    return
  }
  const body = await readJsonBody(req)
  const target = body?.target
  if (typeof target !== 'string' || target.length === 0) {
    sendError(res, 400, 'POST /safety requires a non-empty "target"')
    return
  }
  const model = typeof body?.model === 'string' ? body.model : undefined
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const args = ['run', 'code-safety', '--', target, ...model === undefined ? [] : ['--model', model]]
  const child = spawn('pnpm', args, { cwd: root, detached: true, stdio: 'ignore' })
  child.on('error', (error) => {
    // Spawn failed after the response was already sent (pnpm missing from
    // PATH, or the child crashed at exec) — nothing further can react to it
    // from this request, so it is only logged for operator visibility.
    console.error(`harness-feed: code-safety scan "${id}" failed to start: ${error.message}`)
  })
  child.unref()
  sendJson(res, 202, { id })
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/** Parse `--port <n>` and `--fixtures <dir>` from argv, defaulting the port to {@link DEFAULT_PORT}. */
export function parseHarnessFeedArgs(argv: readonly string[]): { port: number; fixturesDir?: string } {
  let port = DEFAULT_PORT
  let fixturesDir: string | undefined
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--port' && argv[i + 1] !== undefined) {
      port = Number(argv[i + 1])
      i += 1
    } else if (argv[i] === '--fixtures' && argv[i + 1] !== undefined) {
      fixturesDir = argv[i + 1]
      i += 1
    }
  }
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`harness-feed: --port must be a positive integer, got "${port}"`)
  }
  return { port, fixturesDir }
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const { port, fixturesDir } = parseHarnessFeedArgs(process.argv.slice(2))
  const server = createHarnessFeedServer({ root, fixturesDir: fixturesDir === undefined ? undefined : resolve(fixturesDir) })
  server.listen(port, () => {
    console.log(`harness-feed: listening on http://localhost:${port}${fixturesDir === undefined ? '' : ` (fixtures: ${fixturesDir})`}`)
  })
}
