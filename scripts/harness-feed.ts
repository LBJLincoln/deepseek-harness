#!/usr/bin/env node
/**
 * Zero-dependency HTTP + Server-Sent Events feed for the enterprise proof of
 * concept's front end. Serves the generated roster with live status and
 * evidence overlaid from real session data, discovers proving-ground and
 * code-safety runs on disk, folds a run's session logs into a normalized event
 * stream, lists every program run as the organisation of record, and starts a
 * code-safety scan as a detached child process.
 *
 * Four independent discovery paths feed `discoverRuns`: `.proving-ground/runs`
 * and `.code-safety` are gitignored runtime output a fresh checkout does not
 * have; `data/proving-ground` and `data/code-safety` are committed historical
 * records a fresh checkout does have, though with none of a specific run
 * until one is recorded into it. Every handler tolerates all four being
 * absent, never treats a malformed log line as fatal, and never assumes a
 * decoded line matches this module's expected shape — see
 * `scripts/session-records.ts`, {@link streamJsonlLines}, and {@link foldSessionEvent}.
 * A session is placed on a roster seat only by the rules
 * `scripts/roster-evidence.ts` states, the same rules the committed roster's
 * evidence is computed with; a session no rule places is counted as
 * unattributed and its events carry no `agentId`.
 * `--fixtures <dir>` substitutes a self-contained directory (mirroring the
 * same four-path layout) for the real discovery roots, which is what lets the
 * front end's own tests run against fixed data; it never substitutes for
 * `data/enterprise/roster.json`, which always names the repository's real
 * generated roster.
 *
 * @module harness-feed
 */

import { spawn } from 'node:child_process'
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

import { CODE_SAFETY_DEPARTMENTS, type Roster, type RosterAgentDefinition } from './enterprise-roster.ts'
import {
  attributeRun,
  evidenceFor,
  parseProgramSession,
  summarizeEvidence,
  type AttributedRun,
  type AttributedSession,
  type EvidenceSeat,
} from './roster-evidence.ts'
import {
  CODE_SAFETY_RECORDS,
  foldSessionFacts,
  listDirSafe,
  PROVING_GROUND_RECORDS,
  readJsonlLines,
  recordIds,
  sessionFilesIn,
  statSafeIsDirectory,
  typeOf,
  type SessionFacts,
  type SessionLine,
} from './session-records.ts'

/** Default TCP port; overridden with `--port <n>`. */
export const DEFAULT_PORT = 4711

/** A discovered run's kind, named by which real or fixture directory produced it. */
export type RunKind = 'program' | 'fleet' | 'experiment' | 'code-safety'

/** A discovered run's lifecycle state, inferred from its plan/log/certificate data. */
export type RunStatus = 'running' | 'completed' | 'failed' | 'unknown'

/**
 * The fields a `.proving-ground/runs/<id>/plan.json` may declare. This file is
 * a verbatim copy of the user-authored plan `scripts/proving-ground.ts` ran
 * (see its own `planKind`), so it never carries an explicit `kind`, `status`,
 * or `endedAt` — {@link classifyPlanKind} and {@link resolveRunLogStatus}
 * derive those from the arms it declares and from `run.log`.
 */
interface PlanFile {
  name?: string
  startedAt?: string
  /** A fleet plan's per-model arms. */
  models?: unknown
  /** A frozen-experiment plan's two arms. */
  baseline?: unknown
  candidate?: unknown
  /** A `ProgramSpec`-shaped plan's goal list (`packages/improvement/program`), for a program co-located under this same discovery root. */
  goals?: unknown
}

/** The fields this module reads from a recorded `data/proving-ground/<id>/manifest.json`, always written by the recording step. */
interface RecordedRunManifest {
  run?: string
  ranAt?: string
  endedAt?: string
  /**
   * Repository-relative path to the fixture composition the run booted; a
   * `program` path names a program recording when {@link RecordedRunResult}
   * does not already say so.
   */
  composition?: string
}

/**
 * The fields this module reads from a recorded `data/proving-ground/<id>/result.json`
 * to classify its kind; see {@link classifyRecordedRun}.
 */
interface RecordedRunResult {
  /** A fleet's or a program's report; `goals` names a program's department list, `group`/`cells` a fleet's per-cell report. */
  report?: { group?: string; cells?: unknown; goals?: unknown }
  /** A frozen experiment's statistical comparison; `arms.baseline`/`arms.candidate` name its two arms. */
  result?: { arms?: { baseline?: unknown; candidate?: unknown } }
}

/**
 * The fields this module reads from a code-safety run's locked target: a live
 * `.code-safety/<id>/repo/target.json` (the `TargetLock` the program driver
 * commits, `examples/headless-agent/tests/fixtures/program-code-safety/driver.ts`)
 * and a recorded `data/code-safety/<id>/manifest.json`'s `target` field both
 * carry `root`, which is all this module reads; `files` differs in shape
 * between the two (a path-to-hash record live, a plain count recorded) and is
 * not read here.
 */
interface TargetLock {
  root?: string
}

/** One discovered run directory, from `.proving-ground/runs`, `data/proving-ground`, `.code-safety`, or `data/code-safety`. */
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
  /**
   * The roster seat the event's session is attributed to (`scripts/roster-evidence.ts`);
   * absent when no rule places the session on a seat.
   */
  agentId?: string
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
 * {@link FeedEvent} field except `agentId`, which requires the session's whole
 * run (see `attributeRun` in `scripts/roster-evidence.ts`) and is merged in by
 * the caller.
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

/**
 * One finding row, passed through from the run's `findings.json` verbatim
 * beyond normalization. A finding carries no `department` field — its `id`
 * is prefixed with its department id instead (`access-idor-allocations`),
 * which {@link buildSafetyDetail} matches against the six fixed
 * {@link CODE_SAFETY_DEPARTMENTS}; `department` is read first when present,
 * for a shape a future writer adds it to.
 */
export interface SafetyFinding {
  id?: string
  department?: string
  cwe?: string
  owasp?: string
  severity?: FeedSeverity
  confidence?: 'confirmed' | 'likely' | 'possible'
  title?: string
  file?: string
  line?: number
  snippet?: string
  evidence?: string
  impact?: string
  fix?: string
  references?: string[]
  message?: string
  [key: string]: unknown
}

/** The run's verifier output, normalized from `verifier.json`, `verifier.txt`, or a live run's `stdout.jsonl`; see {@link readVerifier}. */
export interface SafetyCertificate {
  verified: boolean
  verifier: string
  checkedAt?: string
  /** The verifier's own report text, when captured. */
  output?: string
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

/**
 * A roster seat with live status computed from real session data, replacing
 * the generated file's static `"defined"`: a seat stays `"defined"` exactly
 * when no discovered session is attributed to it.
 */
export type LiveRosterAgent = Omit<RosterAgentDefinition, 'status'> & {
  status: RosterAgentDefinition['status'] | 'active' | 'certified' | 'failed'
}

/**
 * The `/roster` response: the generated roster with every seat's status and
 * evidence, `counts.occupied`, `counts.active`, the roster's `evidence` and its
 * `unattributed` bucket recomputed over the runs the feed discovers.
 */
export type LiveRoster = Omit<Roster, 'agents'> & { agents: LiveRosterAgent[] }

/** Tool names that register the subagent delegation capability; a call/result for one of these folds to `delegation`, not `tool`. */
const DELEGATION_TOOL_NAMES = new Set(['subagent', 'subagent_control', 'subagent_report'])

/** Case-insensitive phrases that mark a failed tool result as a policy refusal rather than an ordinary tool error. */
const REFUSAL_PATTERN = /denied|refused|blocked|not permitted|requires reading/i

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

// ---------------------------------------------------------------------------
// Run discovery
// ---------------------------------------------------------------------------

/**
 * Classify a `.proving-ground/runs/<id>/plan.json` by the arms it declares,
 * mirroring `scripts/proving-ground.ts`'s own `planKind`: a `models` array is
 * a fleet, a `baseline`/`candidate` pair is a frozen experiment, and a
 * `goals` array (`packages/improvement/program`'s `ProgramSpec`) is a program
 * spec co-located under the same discovery root. Tolerant where `planKind` is
 * strict — a malformed or ambiguous plan must never break `GET /runs`.
 * @param plan - the parsed plan file, or `undefined` when absent or unparsable.
 * @param fallback - the kind to report when nothing on the plan is conclusive.
 * @returns the inferred run kind.
 */
function classifyPlanKind(plan: PlanFile | undefined, fallback: RunKind): RunKind {
  if (plan === undefined) return fallback
  if (Array.isArray(plan.goals)) return 'program'
  if (Array.isArray(plan.models)) return 'fleet'
  if (plan.baseline !== undefined && plan.candidate !== undefined) return 'experiment'
  return fallback
}

/**
 * Classify a recorded `data/proving-ground/<id>` run from its `result.json`
 * (preferred: it carries the frozen plan and report) or `manifest.json`.
 * `report.goals` names a program's department list, `result.arms` names a
 * frozen experiment's two arms, and `report.group`/`report.cells` names a
 * fleet's per-cell report; the directory id and the manifest's `composition`
 * fixture path are the last resort when neither file states a shape this
 * function recognizes.
 * @param id - the run directory name, used as a name-based last resort.
 * @param result - the parsed `result.json`, or `undefined` when absent or unparsable.
 * @param manifest - the parsed `manifest.json`, or `undefined` when absent or unparsable.
 * @returns the inferred run kind; defaults to `experiment` when nothing matches.
 */
function classifyRecordedRun(id: string, result: RecordedRunResult | undefined, manifest: RecordedRunManifest | undefined): RunKind {
  if (Array.isArray(result?.report?.goals)) return 'program'
  if (result?.result?.arms?.baseline !== undefined && result.result.arms.candidate !== undefined) return 'experiment'
  if (result?.report?.group !== undefined && Array.isArray(result.report.cells)) return 'fleet'
  if (/program/i.test(id) || (manifest?.composition !== undefined && /program/i.test(manifest.composition))) return 'program'
  return 'experiment'
}

/**
 * One `.proving-ground/runs/<id>` fleet, experiment, or program run:
 * `plan.json` names its arms/name/timestamps (all optional; absence falls
 * back to a directory stat and the `experiment` kind), status and `endedAt`
 * come from `run.log` (see {@link resolveRunLogStatus}), and its sessions
 * live under `.sessions`.
 */
function discoverProvingGroundRuns(discoveryRoot: string): RunSummary[] {
  const base = join(discoveryRoot, '.proving-ground/runs')
  const runs: RunSummary[] = []
  for (const id of listDirSafe(base).sort()) {
    const dir = join(base, id)
    if (!statSafeIsDirectory(dir)) continue
    const plan = readJsonSafe(join(dir, 'plan.json')) as PlanFile | undefined
    const { status, endedAt } = resolveRunLogStatus(dir)
    runs.push({
      id,
      kind: classifyPlanKind(plan, 'experiment'),
      name: plan?.name ?? id,
      startedAt: plan?.startedAt ?? mtimeIso(dir) ?? new Date(0).toISOString(),
      ...endedAt === undefined ? {} : { endedAt },
      status,
      path: relative(discoveryRoot, dir),
    })
  }
  return runs
}

/**
 * The recorded, read-only runs under one `data/<subdir>/<id>/sessions/*.jsonl`
 * tree. These are committed historical records, so a run with no explicit end
 * marker is still reported `completed` rather than `running`.
 * @param discoveryRoot - The repository root the records live under.
 * @param subdir - The record tree, relative to the root.
 * @param kindOf - Names a record's kind from its id, directory and manifest.
 * @returns One summary per record directory that holds a `sessions/` directory.
 */
function discoverRecordedRuns(
  discoveryRoot: string,
  subdir: string,
  kindOf: (id: string, dir: string, manifest: RecordedRunManifest | undefined) => RunKind,
): RunSummary[] {
  const runs: RunSummary[] = []
  for (const id of recordIds(discoveryRoot, subdir)) {
    const dir = join(discoveryRoot, subdir, id)
    const manifest = readJsonSafe(join(dir, 'manifest.json')) as RecordedRunManifest | undefined
    const endedAt = manifest?.endedAt ?? mtimeIso(dir)
    runs.push({
      id,
      kind: kindOf(id, dir, manifest),
      name: manifest?.run ?? id,
      startedAt: manifest?.ranAt ?? mtimeIso(dir) ?? new Date(0).toISOString(),
      ...endedAt === undefined ? {} : { endedAt },
      status: 'completed',
      path: relative(discoveryRoot, dir),
    })
  }
  return runs
}

/**
 * One `data/proving-ground/<id>` record, its kind read from `result.json`.
 * @param discoveryRoot - The repository root the records live under.
 * @returns The recorded Proving Ground runs.
 */
function discoverRecordedProvingGroundRuns(discoveryRoot: string): RunSummary[] {
  return discoverRecordedRuns(discoveryRoot, PROVING_GROUND_RECORDS, (id, dir, manifest) => {
    const result = readJsonSafe(join(dir, 'result.json')) as RecordedRunResult | undefined
    return classifyRecordedRun(id, result, manifest)
  })
}

/** One JSON line this module recognizes at the tail of a code-safety run's `stdout.jsonl`. */
interface CodeSafetyResultLine {
  type?: unknown
  report?: { outcome?: unknown }
  verifier?: { exitCode?: unknown; output?: unknown }
}

/**
 * Read a live `.code-safety/<id>` run's `stdout.jsonl` and return its last
 * successfully parsed JSON line, or `undefined` when the file is missing,
 * empty, or holds no JSON yet. The program driver
 * (`examples/headless-agent/tests/fixtures/program-code-safety/driver.ts`)
 * writes exactly one `type: "result"` line, only once every department and
 * the integration have finished; {@link resolveCodeSafetyStdoutStatus} and
 * {@link readVerifier} both read it from here rather than reparsing the file.
 * @param dir - the run directory containing `stdout.jsonl`.
 * @returns the last decoded line, or `undefined`.
 */
function readCodeSafetyResultLine(dir: string): CodeSafetyResultLine | undefined {
  let text: string
  try {
    text = readFileSync(join(dir, 'stdout.jsonl'), 'utf8')
  } catch {
    return undefined
  }
  let terminal: CodeSafetyResultLine | undefined
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim()
    if (trimmed.length === 0) continue
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (typeof parsed === 'object' && parsed !== null) terminal = parsed
    } catch {
      continue
    }
  }
  return terminal
}

/**
 * Resolve a live `.code-safety/<id>` run's status from `stdout.jsonl`'s
 * terminal line (see {@link readCodeSafetyResultLine}): an empty or
 * result-less file means the run is still in progress. The line's
 * `report.outcome` and `verifier.exitCode` are `scripts/code-safety.ts`'s own
 * success criterion (`outcome === 'released' && exitCode === 0`); anything
 * else recorded there is `failed`, matching what the wrapper's own non-zero
 * exit reports. A process that crashed before writing that line is
 * indistinguishable on disk from one still running — `running` is the honest
 * answer for both, the same principle {@link resolveRunLogStatus} documents
 * for a proving-ground run.
 * @param dir - the run directory containing `stdout.jsonl`.
 * @returns the resolved status, and the file's own mtime as `endedAt` once terminal.
 */
function resolveCodeSafetyStdoutStatus(dir: string): { status: RunStatus; endedAt?: string } {
  const terminal = readCodeSafetyResultLine(dir)
  if (terminal === undefined || terminal.type !== 'result') return { status: 'running' }
  const released = terminal.report?.outcome === 'released' && terminal.verifier?.exitCode === 0
  const endedAt = mtimeIso(join(dir, 'stdout.jsonl'))
  return { status: released ? 'completed' : 'failed', ...endedAt === undefined ? {} : { endedAt } }
}

/**
 * One live `.code-safety/<id>` scan run (`scripts/code-safety.ts`'s output
 * directory): status and `endedAt` come from `stdout.jsonl` (see
 * {@link resolveCodeSafetyStdoutStatus}); member and integration session logs
 * live under `.sessions`, which `sessionFilesIn` in `scripts/session-records.ts` reads.
 */
function discoverCodeSafetyRuns(discoveryRoot: string): RunSummary[] {
  const base = join(discoveryRoot, '.code-safety')
  const runs: RunSummary[] = []
  for (const id of listDirSafe(base).sort()) {
    const dir = join(base, id)
    if (!statSafeIsDirectory(dir)) continue
    const { status, endedAt } = resolveCodeSafetyStdoutStatus(dir)
    runs.push({
      id,
      kind: 'code-safety',
      name: id,
      startedAt: mtimeIso(dir) ?? new Date(0).toISOString(),
      ...endedAt === undefined ? {} : { endedAt },
      status,
      path: relative(discoveryRoot, dir),
    })
  }
  return runs
}

/**
 * One recorded `data/code-safety/<id>` review: always `completed`, always a
 * `code-safety` run, with `manifest.json` naming its timestamps.
 * @param discoveryRoot - The repository root the records live under.
 * @returns The recorded code-safety reviews.
 */
function discoverRecordedCodeSafetyRuns(discoveryRoot: string): RunSummary[] {
  return discoverRecordedRuns(discoveryRoot, CODE_SAFETY_RECORDS, () => 'code-safety')
}

/** One JSON line this module recognizes at the tail of a driver's `run.log`; every other field is data this module does not read. */
interface RunLogTerminalLine {
  type?: unknown
  endedAt?: unknown
}

/**
 * Resolve a live `.proving-ground/runs/<id>` run's status from the last JSON
 * line its driver appended to `run.log`. Every fleet and experiment driver in
 * this repository (`examples/headless-agent/tests/fixtures/proving-ground-bench/{fleet,experiment}-driver.ts`)
 * writes a `type: "result"` line carrying `endedAt` as the final line it
 * prints before exiting — `run.log` tees that same stdout — so that line's
 * presence is what distinguishes a completed run from one still writing; a
 * last line of type `error` or `refused` marks a run its driver gave up on.
 * This module defines no writer of those two types yet, the same
 * forward-looking-vocabulary precedent {@link foldSessionEvent} documents for
 * the parallel proving-ground and code-safety programs. `run.log` also opens
 * with one plain-text banner line (`runTeeingToLog`'s `=== <timestamp> ... ===`),
 * which never parses as JSON and is skipped rather than treated as malformed.
 * Never throws: a missing or empty `run.log` (no driver has started writing
 * yet) reports `unknown`, and a `run.log` with no terminal JSON line yet (a
 * live process still running) reports `running`.
 * @param dir - the run directory containing `run.log`.
 * @returns the resolved status, and the completed run's `endedAt` when known.
 */
function resolveRunLogStatus(dir: string): { status: RunStatus; endedAt?: string } {
  let text: string
  try {
    text = readFileSync(join(dir, 'run.log'), 'utf8')
  } catch {
    return { status: 'unknown' }
  }
  let terminal: RunLogTerminalLine | undefined
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim()
    if (trimmed.length === 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      // The banner line `runTeeingToLog` prepends, or a torn line at the tail
      // of a still-writing process — neither is a driver's own status line.
      continue
    }
    if (typeof parsed === 'object' && parsed !== null) terminal = parsed
  }
  if (terminal === undefined) return { status: 'running' }
  if (terminal.type === 'result') {
    return typeof terminal.endedAt === 'string' ? { status: 'completed', endedAt: terminal.endedAt } : { status: 'completed' }
  }
  if (terminal.type === 'error' || terminal.type === 'refused') return { status: 'failed' }
  return { status: 'running' }
}

/**
 * Read and normalize a run's verifier reading, from whichever real source
 * this run recorded, checked in this order: a structured `verifier.json` (a
 * format this module accepts but no writer emits today); a recorded run's
 * plain-text `verifier.txt` (`exit <code>\n<output>`, written by
 * `data/code-safety/tools/record-run.mjs`); or a live run's `stdout.jsonl`
 * terminal line's own `verifier: { exitCode, output }` field (see
 * {@link readCodeSafetyResultLine}).
 * @param runDir - the run directory.
 * @returns the normalized certificate, or `undefined` when no verifier reading exists yet.
 */
function readVerifier(runDir: string): SafetyCertificate | undefined {
  const structured = readJsonSafe(join(runDir, 'verifier.json')) as Partial<SafetyCertificate> | undefined
  if (structured !== undefined) return normalizeCertificate(structured)

  let plainText: string | undefined
  try {
    plainText = readFileSync(join(runDir, 'verifier.txt'), 'utf8')
  } catch {
    plainText = undefined
  }
  if (plainText !== undefined) {
    const match = /^exit (-?\d+)\n([\s\S]*)$/.exec(plainText)
    if (match === null) return undefined
    const [, exitCode, output] = match
    // Both groups are non-optional in the pattern above, so a successful
    // match always captures them; the fallback only satisfies
    // `noUncheckedIndexedAccess`'s general array-index typing.
    return normalizeCertificate({ verified: exitCode === '0', verifier: 'verify-safety-report.mjs', output: output ?? '' })
  }

  const verifierField = readCodeSafetyResultLine(runDir)?.verifier
  const exitCode = verifierField?.exitCode
  const output = verifierField?.output
  if (typeof exitCode !== 'number') return undefined
  return normalizeCertificate({
    verified: exitCode === 0,
    verifier: 'verify-safety-report.mjs',
    ...typeof output === 'string' ? { output } : {},
  })
}

/** Fill in every {@link SafetyCertificate} field a partial verifier record left out. */
function normalizeCertificate(partial: Partial<SafetyCertificate>): SafetyCertificate {
  return {
    verified: partial.verified ?? false,
    verifier: partial.verifier ?? 'unknown',
    ...partial.checkedAt === undefined ? {} : { checkedAt: partial.checkedAt },
    ...partial.output === undefined ? {} : { output: partial.output },
    counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0, ...partial.counts },
    unverified: partial.unverified ?? [],
  }
}

/**
 * Discover every run this feed knows how to find. `.proving-ground/runs`,
 * `data/proving-ground`, `.code-safety`, and `data/code-safety` are
 * independent and each may be absent; a missing directory contributes no
 * runs rather than an error.
 * @param discoveryRoot - the real repository root, or a `--fixtures` directory.
 * @returns every discovered run, newest first.
 */
export function discoverRuns(discoveryRoot: string): RunSummary[] {
  const runs = [
    ...discoverProvingGroundRuns(discoveryRoot),
    ...discoverRecordedProvingGroundRuns(discoveryRoot),
    ...discoverCodeSafetyRuns(discoveryRoot),
    ...discoverRecordedCodeSafetyRuns(discoveryRoot),
  ]
  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

/**
 * @param discoveryRoot - the directory the run was discovered under.
 * @param run - the run.
 * @returns every session file of the run, read through `sessionFilesIn` in `scripts/session-records.ts`.
 */
export function sessionFilesForRun(discoveryRoot: string, run: RunSummary): string[] {
  return sessionFilesIn(join(discoveryRoot, run.path))
}

// ---------------------------------------------------------------------------
// Session log event folding
// ---------------------------------------------------------------------------

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
 * the line carries no product-visible event this stream reports: a line
 * without a string `type` (a header line, or a stray non-session record —
 * see {@link SessionLine}), a chunk/usage/request-header row, or any type
 * this fold does not recognize.
 *
 * Recognizes this repository's real session-event vocabulary — `turn/*`,
 * `step/*`, `tool/call`, `tool/result`, `agent/inbox/spliced`, `hook/*`,
 * `tool-workflow/*`, `tool/code-dispatch*`, `verification/certificate`, and
 * `program/integration` are all in `packages/core/session`'s
 * `KNOWN_SESSION_EVENT_TYPES` — plus a small set of forward-looking types the
 * not-yet-shipped code-safety scanner is expected to emit (`agent/step`, a
 * `finding`-prefixed type, `code-safety/finding`), so no change is needed
 * here once that scanner starts writing real logs.
 * @param line - one decoded `session.jsonl` row.
 * @param state - per-file fold state (tool-call name correlation).
 * @returns the folded event (`agentId` not yet attached), or `undefined` to drop the line.
 */
export function foldSessionEvent(line: SessionLine, state: FoldState): FoldedEvent | undefined {
  const type = typeOf(line)
  if (type === undefined) return undefined
  const data = line.data ?? {}
  const base = { ts: line.time ?? 0, seq: line.seq ?? 0, sessionId: state.sessionId }

  if (type === 'turn/start') return { ...base, kind: 'step', label: `Turn ${stringField(data, 'turn', '?')} started` }
  if (type === 'turn/end') {
    const reason = (data.reason as { kind?: string } | undefined)?.kind
    return {
      ...base,
      kind: 'step',
      label: `Turn ${stringField(data, 'turn', '?')} ended`,
      ...reason === undefined ? {} : { detail: reason },
    }
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
      ...text.length > 0 ? { detail: text.slice(0, 500) } : {},
      ...result?.isError === true ? { severity: 'high' as const } : {},
    }
  }
  if (type.startsWith('tool-workflow/') || type.startsWith('tool/code-dispatch')) {
    return { ...base, kind: 'tool', label: type.split('/')[0] === 'tool-workflow' ? 'workflow' : 'code-dispatch' }
  }

  if (type === 'agent/inbox/spliced' || type.startsWith('hook/')) {
    const inserted = data.inserted as { content?: { text?: string }[] }[] | undefined
    const preview = inserted?.[0]?.content?.[0]?.text?.slice(0, 200)
    return { ...base, kind: 'directive', label: 'directive queued', ...preview === undefined ? {} : { detail: preview } }
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
    const severity = data.severity as FeedSeverity | undefined
    const file = data.file as string | undefined
    const findingLine = data.line as number | undefined
    return {
      ...base,
      kind: 'finding',
      label: stringField(data, 'message', stringField(data, 'rule', 'finding')),
      ...severity === undefined ? {} : { severity },
      ...file === undefined ? {} : { file },
      ...findingLine === undefined ? {} : { line: findingLine },
    }
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Roster liveness and evidence
// ---------------------------------------------------------------------------

/** One session file's facts, kept while the file's size and mtime are unchanged. */
interface CachedFacts {
  size: number
  mtimeMs: number
  facts: SessionFacts
}

/**
 * Session files already folded, by path. Recorded runs never change and a live
 * session file only grows, so the size and mtime a fold was made at decide
 * whether it is still current; this answers `GET /roster`, `GET /programs` and
 * a stream's attribution at the cost of one `stat` per session file after the
 * first read, instead of re-reading every record on the tree (about 2.5 s over
 * the committed records), which is what the deck's probe measures.
 */
const sessionFactsCache = new Map<string, CachedFacts>()

/**
 * Fold one session file to its facts, reusing the previous fold while the file is unchanged.
 * @param file - absolute path of the session file.
 * @returns the facts, or `undefined` when the file is unreadable or empty.
 */
function factsOf(file: string): SessionFacts | undefined {
  let size: number
  let mtimeMs: number
  try {
    ({ size, mtimeMs } = statSync(file))
  } catch {
    // Removed between discovery and this read: the run no longer holds it.
    return undefined
  }
  const cached = sessionFactsCache.get(file)
  if (cached !== undefined && cached.size === size && cached.mtimeMs === mtimeMs) return cached.facts
  const lines = readJsonlLines(file)
  if (lines.length === 0) return undefined
  const facts = foldSessionFacts(lines, file)
  sessionFactsCache.set(file, { size, mtimeMs, facts })
  return facts
}

/**
 * Attribute every readable session file of one run by the rules in `scripts/roster-evidence.ts`.
 * @param discoveryRoot - where the run was discovered.
 * @param run - the run.
 * @param seats - the roster seats.
 * @returns the attributed run, and each readable session file's entry by path.
 */
function attributeRunFiles(
  discoveryRoot: string,
  run: RunSummary,
  seats: readonly EvidenceSeat[],
): { run: AttributedRun; byFile: ReadonlyMap<string, AttributedSession> } {
  const read = sessionFilesForRun(discoveryRoot, run)
    .map(file => ({ file, facts: factsOf(file) }))
    .filter((entry): entry is { file: string; facts: SessionFacts } => entry.facts !== undefined)
  const sessions = attributeRun({ path: run.path, codeSafety: run.kind === 'code-safety', sessions: read.map(entry => entry.facts) }, seats)
  const byFacts = new Map(sessions.map(session => [session.facts, session]))
  const byFile = new Map<string, AttributedSession>()
  for (const { file, facts } of read) {
    const session = byFacts.get(facts)
    if (session !== undefined) byFile.set(file, session)
  }
  return { run: { path: run.path, sessions }, byFile }
}

/**
 * Overlay live status and evidence onto the generated roster. Every discovered
 * run's sessions are attributed by the rules `scripts/roster-evidence.ts`
 * states: a seat is `active` when a session attributed to it belongs to a run
 * still running, `certified` when one of its sessions logged a certificate
 * event, and `failed` when its sessions ended without one. A seat no session
 * is attributed to keeps `"defined"`, and a session no rule places is counted
 * in `unattributed`, never lit on a seat.
 * @param roster - the generated static roster.
 * @param discoveryRoot - where to look for real or fixture run data.
 * @returns the roster with every seat's status and evidence, the counts, the
 *   evidence scope and the unattributed bucket recomputed over the discovered runs.
 */
export function computeLiveRoster(roster: Roster, discoveryRoot: string): LiveRoster {
  const statusByAgent = new Map<string, 'active' | 'certified' | 'failed'>()
  const runs: AttributedRun[] = []
  for (const discovered of discoverRuns(discoveryRoot)) {
    const { run } = attributeRunFiles(discoveryRoot, discovered, roster.agents)
    runs.push(run)
    const running = discovered.endedAt === undefined && discovered.status === 'running'
    for (const { facts, attribution } of run.sessions) {
      if (attribution.kind !== 'seat') continue
      const next: 'active' | 'certified' | 'failed' = facts.certified ? 'certified' : running ? 'active' : 'failed'
      // Precedence when several sessions occupy the same seat: active (still
      // running right now) beats certified, which beats failed — the most
      // "alive" observation wins rather than the last one seen.
      const current = statusByAgent.get(attribution.seatId)
      if (current === 'active') continue
      if (current === 'certified' && next === 'failed') continue
      statusByAgent.set(attribution.seatId, next)
    }
  }
  const summary = summarizeEvidence(runs)
  const agents: LiveRosterAgent[] = roster.agents.map(agent => ({
    ...agent,
    status: statusByAgent.get(agent.id) ?? agent.status,
    evidence: evidenceFor(summary, agent.id),
  }))
  const active = agents.filter(agent => agent.status === 'active').length
  return {
    ...roster,
    counts: { defined: roster.counts.defined, occupied: summary.bySeat.size, active },
    agents,
    evidence: summary.evidence,
    unattributed: summary.unattributed,
  }
}

// ---------------------------------------------------------------------------
// Code-safety detail
// ---------------------------------------------------------------------------

/** @returns the display language for one file path, by extension; `"Other"` when unrecognized. */
function languageForPath(path: string): string {
  return LANGUAGE_BY_EXTENSION[extname(path).toLowerCase()] ?? 'Other'
}

/**
 * @returns the run directory for `id`, preferring a live `.code-safety/<id>`
 *   over a recorded `data/code-safety/<id>`, or `undefined` when neither exists.
 */
function resolveCodeSafetyRunDir(discoveryRoot: string, id: string): string | undefined {
  return [join(discoveryRoot, '.code-safety', id), join(discoveryRoot, 'data/code-safety', id)]
    .find(candidate => statSafeIsDirectory(candidate))
}

/**
 * @returns the reviewed target's root path on this host: a live run's locked
 *   `repo/target.json`, or a recorded run's `manifest.json.target.root`;
 *   `undefined` when neither source names one.
 */
function resolveCodeSafetyTargetRoot(runDir: string): string | undefined {
  const live = readJsonSafe(join(runDir, 'repo/target.json')) as TargetLock | undefined
  if (live?.root !== undefined) return live.root
  const recorded = readJsonSafe(join(runDir, 'manifest.json')) as { target?: TargetLock } | undefined
  return recorded?.target?.root
}

/** @returns the report repository's one `program-<hash>` subdirectory, or `undefined` before the driver has minted it. */
function findProgramDir(repoDir: string): string | undefined {
  const name = listDirSafe(repoDir).find(entry => statSafeIsDirectory(join(repoDir, entry)) && entry.startsWith('program-'))
  return name === undefined ? undefined : join(repoDir, name)
}

/**
 * The directory to read `findings.json`/`SAFETY-REPORT.md` from: a recorded
 * `data/code-safety/<id>` run keeps them flat at its own root; a live
 * `.code-safety/<id>` run keeps them in its report repository's integration
 * worktree, `repo/<programId>/@integration` (`INTEGRATION_KEY` in
 * `@deepseek-ai/dsh-program`), which exists only once every department has
 * merged. `runDir` itself is the tolerant fallback for a run that has
 * reached neither shape yet.
 * @param runDir - the run directory.
 * @returns the directory to read released files from.
 */
function resolveCodeSafetyReleaseDir(runDir: string): string {
  if (existsSync(join(runDir, 'findings.json'))) return runDir
  const repoDir = join(runDir, 'repo')
  const programDir = statSafeIsDirectory(repoDir) ? findProgramDir(repoDir) : undefined
  if (programDir !== undefined) {
    const integrationDir = join(programDir, '@integration')
    if (statSafeIsDirectory(integrationDir)) return integrationDir
  }
  return runDir
}

/**
 * Build the `/safety/:id` response from one code-safety run directory (a live
 * `.code-safety/<id>` or a recorded `data/code-safety/<id>`, see
 * {@link resolveCodeSafetyRunDir}): walks the reviewed target for its file
 * inventory, reads `findings.json` and the verifier reading, and folds both
 * against the six fixed code-safety departments so every department is
 * reported even with zero findings. A finding is attributed to its
 * department by an explicit `department` field when present, else by its
 * `id` prefix (`access-idor-allocations` names `access`) — see
 * {@link SafetyFinding}. Per-severity `certificate.counts` are tallied from
 * `findings` directly, the one source both a live and a recorded run always
 * has, rather than trusted to a verifier reading that carries no counts in
 * either real format.
 * @param discoveryRoot - where the run directory lives.
 * @param id - the run id.
 * @returns the safety detail, or `undefined` when the run does not exist.
 */
export function buildSafetyDetail(discoveryRoot: string, id: string): SafetyDetail | undefined {
  const runDir = resolveCodeSafetyRunDir(discoveryRoot, id)
  if (runDir === undefined) return undefined

  const targetRoot = resolveCodeSafetyTargetRoot(runDir)
  const targetPath = targetRoot !== undefined && existsSync(targetRoot) ? targetRoot : runDir
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

  const releaseDir = resolveCodeSafetyReleaseDir(runDir)
  const findings = (readJsonSafe(join(releaseDir, 'findings.json')) as SafetyFinding[] | undefined) ?? []
  const counts: Record<FeedSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  for (const finding of findings) {
    if (finding.severity !== undefined && finding.severity in counts) counts[finding.severity] += 1
  }
  const certificate = { ...readVerifier(runDir) ?? normalizeCertificate({}), counts }
  const departments: SafetyDepartmentStatus[] = CODE_SAFETY_DEPARTMENTS.map((department) => {
    const departmentFindings = findings.filter(finding => finding.department === department.id
      || (finding.department === undefined && typeof finding.id === 'string' && finding.id.startsWith(`${department.id}-`)))
    const certified = certificate.verified && !certificate.unverified.includes(department.id)
    return {
      id: department.id,
      name: department.name,
      status: departmentFindings.length > 0 ? 'findings' : certificate.verified ? 'clean' : 'pending',
      certified,
      findings: departmentFindings.length,
    }
  })
  const reportPath = join(releaseDir, 'SAFETY-REPORT.md')
  const report = { markdown: existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : '' }

  return {
    target: { name: id, path: targetPath, files, languages },
    departments,
    findings,
    certificate,
    report,
  }
}

// ---------------------------------------------------------------------------
// The organisation of record: recorded program runs
// ---------------------------------------------------------------------------

/** One department of a program run, as `GET /programs` reports it. */
export interface ProgramDepartment {
  /** The goal key the program spec names (`secrets`, `stats`, …). */
  key: string
  sessionId: string
  /** The department's session log, relative to the discovery root; absent when the run holds no file for it. */
  sessionPath?: string
  /** The last status the ledger's `program/goal` events gave the department (`merged`, …); `unknown` with none. */
  status: string
  /** Whether the department's session logged a `verification/certificate` event. */
  certified: boolean
  /** `step/start` events in the department's session. */
  steps: number
  /** `tool/call` events in the department's session. */
  toolCalls: number
  /** The roster seat the attribution rules place the session on; absent when no rule places it. */
  seatId?: string
}

/** The integration step of a program run: the session that merges the departments and its verdict. */
export interface ProgramIntegration {
  sessionId: string
  /** The integration's session log, relative to the discovery root; absent when the run holds no file for it. */
  sessionPath?: string
  /** The last status the ledger's `program/integration` events reported (`running`, `certified`, …); `unknown` with none. */
  status: string
  /** Whether the integration's session logged a `verification/certificate` event. */
  certified: boolean
  /** ISO time of the `program/integration` event that reported `certified`. */
  certifiedAt?: string
  /** The merged revision the integration reported. */
  mergedRevision?: string
  steps: number
  toolCalls: number
  seatId?: string
}

/** One `signoff/recorded` event of the program's ledger: a signature on one transition. */
export interface ProgramSignoff {
  /** The transition signed (`spec-freeze`, `release`, …). */
  transition: string
  /** ISO time the signature was recorded. */
  at?: string
  /** The principal the deployment recorded as having decided; `@deepseek-ai/dsh-signoff` records it and never authenticates it. */
  decidedBy?: { kind: string; id: string; displayName?: string }
  /** Digest of the artefact the signature covers. */
  artefactSha256?: string
}

/**
 * One program run: an entry of `GET /programs`, the organisation of record.
 * Everything here is read from the run's own records: the program's ledger
 * session (`program/start`, `program/goal`, `program/integration`,
 * `program/end`, `signoff/recorded`) and each member session's facts.
 */
export interface ProgramRecord {
  /** `program-<digest>`, the id `@deepseek-ai/dsh-program` mints from the frozen spec. */
  programId: string
  /** The run directory's name. */
  runId: string
  kind: 'code-safety' | 'program'
  /** The run directory, relative to the discovery root. */
  path: string
  /** The reviewed repository's root, for a code-safety review. */
  target?: string
  /** The frozen spec's digest and objective, from `program/start`. */
  spec?: { sha256: string; objective: string }
  /** ISO time of `program/start`, else the run's own start. */
  startedAt: string
  /** ISO time of `program/end`, else the run's own end; absent while it runs. */
  endedAt?: string
  /** `program/end`'s outcome (`released`, …); absent while the program has not ended. */
  outcome?: string
  departments: ProgramDepartment[]
  integration?: ProgramIntegration
  /** Every signature the ledger recorded, in log order. */
  signoffs: ProgramSignoff[]
}

/** What a program's own session (the ledger `@deepseek-ai/dsh-program` writes) states about its run. */
interface ProgramLedger {
  spec?: { sha256: string; objective: string; keys: string[] }
  startedAtMs?: number
  endedAtMs?: number
  outcome?: string
  goals: Map<string, { status: string; sessionId?: string }>
  integration?: { status: string; sessionId?: string; mergedRevision?: string; certifiedAtMs?: number }
  signoffs: ProgramSignoff[]
}

/**
 * @param value - a decoded JSON value.
 * @returns the value when it is a string, else `undefined`.
 */
function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * @param ms - epoch milliseconds, when known.
 * @returns the ISO string, or `undefined`.
 */
function isoAt(ms: number | undefined): string | undefined {
  return ms === undefined ? undefined : new Date(ms).toISOString()
}

/**
 * Read one `signoff/recorded` payload.
 * @param data - the event's `data`.
 * @param at - the event's time, when logged.
 * @returns the signature, or `undefined` when the payload names no transition.
 */
function readSignoff(data: Record<string, unknown>, at: number | undefined): ProgramSignoff | undefined {
  const transition = stringOf(data.transition)
  if (transition === undefined) return undefined
  const principal = data.principal as { kind?: unknown; id?: unknown; displayName?: unknown } | undefined
  const kind = stringOf(principal?.kind)
  const id = stringOf(principal?.id)
  const displayName = stringOf(principal?.displayName)
  const artefactSha256 = stringOf(data.artefactSha256)
  const when = isoAt(at)
  return {
    transition,
    ...when === undefined ? {} : { at: when },
    ...kind === undefined || id === undefined ? {} : { decidedBy: { kind, id, ...displayName === undefined ? {} : { displayName } } },
    ...artefactSha256 === undefined ? {} : { artefactSha256 },
  }
}

/**
 * Fold a program's own session into what it states about the run: the frozen
 * spec, each department's last goal status, the integration's last status,
 * the outcome, and the signatures.
 * @param lines - the program session's decoded lines.
 * @returns the ledger.
 */
function foldProgramLedger(lines: readonly SessionLine[]): ProgramLedger {
  const ledger: ProgramLedger = { goals: new Map(), signoffs: [] }
  for (const line of lines) {
    const data = line.data ?? {}
    const at = typeof line.time === 'number' ? line.time : undefined
    switch (typeOf(line)) {
      case 'program/start': {
        const spec = data.spec as { objective?: unknown; goals?: unknown } | undefined
        const goals: unknown[] = Array.isArray(spec?.goals) ? spec.goals : []
        const keys = goals.map(goal => stringOf((goal as { key?: unknown } | null)?.key)).filter((key): key is string => key !== undefined)
        ledger.spec = { sha256: stringOf(data.specSha256) ?? '', objective: stringOf(spec?.objective) ?? '', keys }
        if (at !== undefined) ledger.startedAtMs = at
        break
      }
      case 'program/goal': {
        const key = stringOf(data.key)
        const status = stringOf(data.status)
        if (key === undefined || status === undefined) break
        const sessionId = stringOf(data.sessionId) ?? ledger.goals.get(key)?.sessionId
        ledger.goals.set(key, sessionId === undefined ? { status } : { status, sessionId })
        break
      }
      case 'program/integration': {
        const status = stringOf(data.status)
        if (status === undefined) break
        const previous = ledger.integration
        const sessionId = stringOf(data.sessionId) ?? previous?.sessionId
        const mergedRevision = stringOf(data.mergedRevision) ?? previous?.mergedRevision
        const certifiedAtMs = status === 'certified' ? at : previous?.certifiedAtMs
        ledger.integration = {
          status,
          ...sessionId === undefined ? {} : { sessionId },
          ...mergedRevision === undefined ? {} : { mergedRevision },
          ...certifiedAtMs === undefined ? {} : { certifiedAtMs },
        }
        break
      }
      case 'program/end': {
        const outcome = stringOf(data.outcome)
        if (outcome !== undefined) ledger.outcome = outcome
        if (at !== undefined) ledger.endedAtMs = at
        break
      }
      case 'signoff/recorded': {
        const signoff = readSignoff(data, at)
        if (signoff !== undefined) ledger.signoffs.push(signoff)
        break
      }
      default:
        // Every other ledger line (the header, resumes, end seeds) states nothing a program record reports.
        break
    }
  }
  return ledger
}

/**
 * @param session - an attributed session, when the run holds one.
 * @returns `{ seatId }` when the rules place the session on a seat, else nothing to spread.
 */
function seatOf(session: AttributedSession | undefined): { seatId?: string } {
  return session?.attribution.kind === 'seat' ? { seatId: session.attribution.seatId } : {}
}

/**
 * Build one program run's record from its sessions.
 * @param discoveryRoot - where the run was discovered.
 * @param run - a `code-safety` or `program` run.
 * @param seats - the roster seats the member sessions are attributed to.
 * @returns the record, or `undefined` when the run holds no program session.
 */
function buildProgram(discoveryRoot: string, run: RunSummary, seats: readonly EvidenceSeat[]): ProgramRecord | undefined {
  const { byFile } = attributeRunFiles(discoveryRoot, run, seats)
  const programSessions = [...byFile].flatMap(([file, session]) => {
    const parsed = parseProgramSession(session.facts.sessionId)
    return parsed === undefined ? [] : [{ file, session, parsed }]
  })
  const programId = (programSessions.find(entry => entry.parsed.member === undefined) ?? programSessions[0])?.parsed.programId
  if (programId === undefined) return undefined
  const members = new Map(programSessions
    .filter(entry => entry.parsed.programId === programId)
    .map(entry => [entry.session.facts.sessionId, entry]))
  const ledgerFile = members.get(programId)?.file
  const ledger: ProgramLedger = ledgerFile === undefined
    ? { goals: new Map(), signoffs: [] }
    : foldProgramLedger(readJsonlLines(ledgerFile))
  const memberFields = (sessionId: string): Pick<ProgramDepartment, 'sessionPath' | 'certified' | 'steps' | 'toolCalls' | 'seatId'> => {
    const member = members.get(sessionId)
    if (member === undefined) return { certified: false, steps: 0, toolCalls: 0 }
    const { facts } = member.session
    return {
      sessionPath: relative(discoveryRoot, member.file),
      certified: facts.certified,
      steps: facts.steps,
      toolCalls: facts.toolCalls,
      ...seatOf(member.session),
    }
  }

  const memberKeys = [...members.values()]
    .map(entry => entry.parsed.member)
    .filter((member): member is string => member !== undefined && member !== '@integration')
  const keys = [...new Set([...ledger.spec?.keys ?? [], ...ledger.goals.keys(), ...memberKeys])]
  const departments: ProgramDepartment[] = keys.map((key) => {
    const goal = ledger.goals.get(key)
    const sessionId = goal?.sessionId ?? `${programId}-${key}`
    return { key, sessionId, status: goal?.status ?? 'unknown', ...memberFields(sessionId) }
  })

  const integrationId = ledger.integration?.sessionId ?? `${programId}-@integration`
  const certifiedAt = isoAt(ledger.integration?.certifiedAtMs)
  const mergedRevision = ledger.integration?.mergedRevision
  const integration: ProgramIntegration | undefined = ledger.integration === undefined && !members.has(integrationId) ? undefined : {
    sessionId: integrationId,
    status: ledger.integration?.status ?? 'unknown',
    ...memberFields(integrationId),
    ...certifiedAt === undefined ? {} : { certifiedAt },
    ...mergedRevision === undefined ? {} : { mergedRevision },
  }

  const target = run.kind === 'code-safety' ? resolveCodeSafetyTargetRoot(join(discoveryRoot, run.path)) : undefined
  const endedAt = isoAt(ledger.endedAtMs) ?? run.endedAt
  return {
    programId,
    runId: run.id,
    kind: run.kind === 'code-safety' ? 'code-safety' : 'program',
    path: run.path,
    ...target === undefined ? {} : { target },
    ...ledger.spec === undefined ? {} : { spec: { sha256: ledger.spec.sha256, objective: ledger.spec.objective } },
    startedAt: isoAt(ledger.startedAtMs) ?? run.startedAt,
    ...endedAt === undefined ? {} : { endedAt },
    ...ledger.outcome === undefined ? {} : { outcome: ledger.outcome },
    departments,
    ...integration === undefined ? {} : { integration },
    signoffs: ledger.signoffs,
  }
}

/**
 * The organisation of record: one entry per program run the feed discovers — a
 * code-safety review, or a Proving Ground program — newest first. Each entry
 * names the departments with their sessions, certificates, steps and tool
 * calls, the integration's verdict, and every signature with its time and the
 * principal recorded as having decided, all read from the run's own session
 * logs.
 * @param discoveryRoot - where to look for real or fixture run data.
 * @param roster - the roster whose seats the member sessions are attributed to.
 * @returns the program records.
 */
export function buildPrograms(discoveryRoot: string, roster: Roster): ProgramRecord[] {
  return discoverRuns(discoveryRoot)
    .filter(run => run.kind === 'code-safety' || run.kind === 'program')
    .flatMap((run) => {
      const program = buildProgram(discoveryRoot, run, roster.agents)
      return program === undefined ? [] : [program]
    })
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
 * Stream-read a session-log file's lines lazily: yields nothing (never
 * throws) when the file cannot be opened, skips a line that fails to parse
 * (a torn write at the tail of a live file) without ending the file's
 * iteration, and stops silently on a read error mid-file so one bad file
 * never takes down the run's replay. Reads in chunks via `readline` rather
 * than materializing the file's lines into an array, so a run's replay never
 * holds more than one line in memory at a time.
 * @param file - absolute path to the JSONL file.
 * @yields each successfully parsed line, in file order.
 */
async function* streamJsonlLines(file: string): AsyncGenerator<SessionLine> {
  let stream: ReturnType<typeof createReadStream>
  try {
    stream = createReadStream(file, { encoding: 'utf8' })
  } catch {
    return
  }
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const raw of rl) {
      const trimmed = raw.trim()
      if (trimmed.length === 0) continue
      try {
        yield JSON.parse(trimmed) as SessionLine
      } catch {
        continue
      }
    }
  } catch {
    // A read error partway through the file (permissions, or the file
    // vanished under a live process) ends this file's replay early; the
    // caller moves on to the next file rather than failing the whole stream.
  } finally {
    rl.close()
    stream.destroy()
  }
}

/**
 * Stream one run's folded events over Server-Sent Events: replay every event
 * currently on disk file by file and event by event, then poll each session
 * file every 500ms for appended lines until the client disconnects. A frame's
 * `agentId` is the seat the run's attribution ({@link attributeRunFiles})
 * places its session on, and is absent for a session no rule places. The
 * attribution reads each file's facts from the per-file cache the roster
 * overlay also fills, so a warm feed pays one `stat` per file before the first
 * frame; the replay pass then streams each file ({@link streamJsonlLines})
 * rather than materializing its lines.
 * @param res - the open response to write SSE frames to.
 * @param discoveryRoot - where the run's session files live.
 * @param run - the run to stream.
 * @param roster - the seats each session is attributed to.
 */
async function streamRunEvents(res: ServerResponse, discoveryRoot: string, run: RunSummary, roster: Roster): Promise<void> {
  res.writeHead(200, {
    ...CORS_HEADERS,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  const files = sessionFilesForRun(discoveryRoot, run)
  const { byFile } = attributeRunFiles(discoveryRoot, run, roster.agents)
  const offsetByFile = new Map<string, number>()
  const stateByFile = new Map<string, FoldState>()
  const seatByFile = new Map<string, string>()

  const send = (event: FoldedEvent, seatId: string | undefined): void => {
    const frame: FeedEvent = seatId === undefined ? event : { ...event, agentId: seatId }
    res.write(`id: ${event.seq}\ndata: ${JSON.stringify(frame)}\n\n`)
  }

  for (const file of files) {
    const placed = byFile.get(file)
    const seatId = placed?.attribution.kind === 'seat' ? placed.attribution.seatId : undefined
    const state: FoldState = { sessionId: placed?.facts.sessionId ?? file, callNameById: new Map() }
    stateByFile.set(file, state)
    if (seatId !== undefined) seatByFile.set(file, seatId)
    for await (const line of streamJsonlLines(file)) {
      const event = foldSessionEvent(line, state)
      if (event !== undefined) send(event, seatId)
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
      const seatId = seatByFile.get(file)
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
        if (event !== undefined) send(event, seatId)
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
  /** Fold every session file once as soon as the server exists, so the first `GET /roster` answers from the per-file cache. */
  warm?: boolean
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

  if (options.warm === true) {
    setImmediate(() => {
      try {
        computeLiveRoster(loadRoster(), discoveryRoot)
      } catch {
        // A missing or malformed roster file: the first GET /roster reports it to the caller.
      }
    })
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
    if (req.method === 'GET' && pathname === '/programs') {
      sendJson(res, 200, buildPrograms(discoveryRoot, loadRoster()))
      return
    }
    const eventsMatch = /^\/runs\/([^/]+)\/events$/.exec(pathname)
    if (req.method === 'GET' && eventsMatch !== null) {
      const run = discoverRuns(discoveryRoot).find(candidate => candidate.id === eventsMatch[1])
      if (run === undefined) {
        sendError(res, 404, `no run "${eventsMatch[1]}"`)
        return
      }
      // Fire-and-forget: the SSE stream outlives this request handler. A
      // rejection here is unexpected (every per-line and per-file failure
      // inside streamRunEvents is already caught), so this only ends a
      // response left hanging open rather than leaving the connection stuck.
      void streamRunEvents(res, discoveryRoot, run, loadRoster()).catch((error: unknown) => {
        console.error(`harness-feed: streaming run "${run.id}" failed: ${error instanceof Error ? error.message : String(error)}`)
        if (!res.writableEnded) res.end()
      })
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
  // The id is the run directory's name under `.code-safety/`, the same
  // `<target basename>-<stamp>` the script would choose on its own, passed as
  // `--out` so the id this response returns is the id the run is discovered under.
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-').slice(0, 19)
  const id = `${basename(target)}-${stamp}`
  const args = ['run', 'code-safety', '--', target, '--out', join(root, '.code-safety', id), ...model === undefined ? [] : ['--model', model]]
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
  return { port, ...fixturesDir === undefined ? {} : { fixturesDir } }
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const { port, fixturesDir } = parseHarnessFeedArgs(process.argv.slice(2))
  const server = createHarnessFeedServer({ root, warm: true, ...fixturesDir === undefined ? {} : { fixturesDir: resolve(fixturesDir) } })
  server.listen(port, () => {
    console.log(`harness-feed: listening on http://localhost:${port}${fixturesDir === undefined ? '' : ` (fixtures: ${fixturesDir})`}`)
  })
}
