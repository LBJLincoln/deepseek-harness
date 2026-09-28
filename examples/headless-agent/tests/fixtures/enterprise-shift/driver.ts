#!/usr/bin/env node
/**
 * Driver of one enterprise shift: clone the development branch tip into a
 * scratch directory, select open tickets, run one program whose departments
 * are those tickets, review every certified department in a session that never
 * saw the department's, assemble the approved departments into one commit per
 * ticket on the branch, re-run their acceptance over that tree, push it
 * fast-forward with the shift's ledger lines and record, and print the result.
 *
 * The same driver serves the keyless composition beside it and the Claude Code
 * overlay under `overlays/`: what changes between the two is the route the
 * departments and the reviewer are driven on, never the shift.
 *
 * Environment: `DSH_ENTERPRISE_REMOTE` (the repository cloned from and pushed
 * to), `DSH_ENTERPRISE_BRANCH`, `DSH_ENTERPRISE_SCRATCH` (this shift's own
 * directory), one of `DSH_ENTERPRISE_NEXT` / `DSH_ENTERPRISE_TICKETS`, and the
 * optional `DSH_ENTERPRISE_REFERENCE` (a local repository whose objects the
 * clone borrows), `DSH_ENTERPRISE_IMPLEMENTER` (`route`, the default, or
 * `subagent`), `DSH_ENTERPRISE_PUSH=1`, `DSH_ENTERPRISE_QUEUE_POLICY=open`,
 * `DSH_ENTERPRISE_SHIFT` (the shift id) and `DSH_ENTERPRISE_KEEP=1` (keep the
 * clone when the shift ends).
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { foldBudgetSpend } from '@deepseek-ai/dsh-budget-policy'
import type {} from '@deepseek-ai/dsh-goal'
import { createUserMessage, QUOTA_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import type { LlmFailure } from '@deepseek-ai/dsh-llm'
import { programIdFor, programSpecDigest, resolveProgramSpec } from '@deepseek-ai/dsh-program'
import type { ProgramGoalOutcome, ProgramReport, ProgramSpec } from '@deepseek-ai/dsh-program'
import type {} from '@deepseek-ai/dsh-read-barrier'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-signoff'
import type { CheckId, StandardCheck } from '@deepseek-ai/dsh-verification/types'
import { HARNESS_QUEUE_POLICY, OPEN_QUEUE_POLICY } from '../../../../../scripts/enterprise-tickets.ts'
import { ROSTER_PATH } from '../../../../../scripts/enterprise-roster.ts'
import type { Roster } from '../../../../../scripts/enterprise-roster.ts'
import {
  departmentKey,
  departmentObjective,
  LEDGER_PATH,
  parseLedger,
  readQueue,
  readReviewVerdict,
  redactCredentials,
  REVIEW_INSTRUCTION,
  reviewEvidenceText,
  reviewTicketText,
  selectTickets,
  shiftCommitMessage,
  shiftIdFor,
  shiftRecordName,
  SHIFTS_DIR,
  shippedCommitMessage,
  ticketChecks,
} from './shift.ts'
import type {
  CommitTrailers,
  DepartmentOutcome,
  ImplementerKind,
  IntegrationOutcome,
  ReviewedCheck,
  ReviewVerdict,
  Ticket,
  TicketLedgerLine,
  TicketSelection,
} from './shift.ts'

/** The operator's session, which every commit of the enterprise names. */
const CLAUDE_SESSION = 'https://claude.ai/code/session_01HEXjzxR7CyMizem5kFAB4C'

/** The preset the reviewer session composes: no tool, the judge role. */
const REVIEW_PRESET = 'reviewing'

/** Bound of the diff and of each check's output the reviewer reads. */
const REVIEW_TEXT_MAX_CHARS = 48_000

/** Bound of the rationale a ledger line records. */
const RATIONALE_MAX_CHARS = 2000

/** The subagent provider `--implementer subagent` delegates to. */
const SUBAGENT_PROVIDER = 'claude-code'

/** Rounds the push loop takes when the tip keeps moving. */
const PUSH_ROUNDS = 3

/** The shift as its environment configured it. */
interface ShiftConfig {
  readonly remote: string
  readonly branch: string
  readonly reference: string | undefined
  readonly scratch: string
  readonly selection: TicketSelection
  readonly implementer: ImplementerKind
  readonly push: boolean
  readonly openPolicy: boolean
  readonly shift: string
  readonly keep: boolean
}

/** One ticket's state as the shift moves it along. */
interface TicketRun {
  readonly ticket: Ticket
  readonly key: string
  outcome: DepartmentOutcome
  sessionId: string | null
  revision: string | undefined
  checks: { id: string; ok: boolean }[]
  reviewed: ReviewedCheck[]
  review: { verdict: ReviewVerdict; sessionId: string | null; rationale: string }
  integration: IntegrationOutcome
  commit: string | null
  reason: string
  tokens: number
  seconds: number
}

/** The halt a route limit imposed, once one did. */
interface Halt {
  readonly kind: 'limit'
  readonly sessionId: string
  readonly failure: LlmFailure
  readonly resetsAt: string | null
}

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('enterprise-shift driver requires a config path')

/** One required environment value. */
function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`enterprise-shift driver requires ${name}`)
  return value
}

/** The configuration, read once from the environment. */
function readConfig(startedAt: Date): ShiftConfig {
  const next = process.env['DSH_ENTERPRISE_NEXT']
  const named = process.env['DSH_ENTERPRISE_TICKETS']
  if ((next === undefined) === (named === undefined)) {
    throw new Error('enterprise-shift driver requires exactly one of DSH_ENTERPRISE_NEXT and DSH_ENTERPRISE_TICKETS')
  }
  const implementer = process.env['DSH_ENTERPRISE_IMPLEMENTER'] ?? 'route'
  if (implementer !== 'route' && implementer !== 'subagent') throw new Error(`DSH_ENTERPRISE_IMPLEMENTER must be route or subagent, got ${implementer}`)
  return {
    remote: required('DSH_ENTERPRISE_REMOTE'),
    branch: required('DSH_ENTERPRISE_BRANCH'),
    reference: process.env['DSH_ENTERPRISE_REFERENCE'],
    scratch: required('DSH_ENTERPRISE_SCRATCH'),
    selection: next !== undefined
      ? { kind: 'next', count: Number(next) }
      : { kind: 'tickets', ids: (named ?? '').split(',').map(id => id.trim()).filter(id => id !== '') },
    implementer,
    push: process.env['DSH_ENTERPRISE_PUSH'] === '1',
    openPolicy: process.env['DSH_ENTERPRISE_QUEUE_POLICY'] === 'open',
    shift: process.env['DSH_ENTERPRISE_SHIFT'] ?? shiftIdFor(startedAt, randomBytes(2).toString('hex')),
    keep: process.env['DSH_ENTERPRISE_KEEP'] === '1',
  }
}

/** Run one git command in a directory and return its trimmed stdout. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trimEnd()
}

/** Run one git command that may fail, returning whether it exited zero and what it wrote. */
function tryGit(cwd: string, ...args: string[]): { ok: boolean; output: string } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}`.trim() }
}

/** Run one shell command line at a directory, as the program's checks run: exit 0 is a pass. */
function runCheck(cwd: string, command: string): { ok: boolean; output: string } {
  const result = spawnSync('bash', ['-c', command], { cwd, encoding: 'utf8', env: process.env })
  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}`.trim() }
}

/**
 * Install the repository's dependencies from the warm store, when it has a
 * lockfile to install from. A repository without one installs nothing.
 * @param cwd - the checkout to install in.
 */
function installOffline(cwd: string): void {
  if (!existsSync(join(cwd, 'pnpm-lock.yaml'))) return
  const result = spawnSync('pnpm', ['install', '--offline', '--frozen-lockfile'], { cwd, encoding: 'utf8', env: process.env })
  if (result.status !== 0) throw new Error(`pnpm install --offline --frozen-lockfile failed in ${cwd}: ${`${result.stdout}${result.stderr}`.slice(-2000)}`)
}

/**
 * Clone the branch tip into the scratch directory.
 * @returns the clone path and the tip it was cut at.
 */
function cloneTip(config: ShiftConfig): { repo: string; base: string } {
  const repo = join(config.scratch, 'repo')
  if (existsSync(repo)) throw new Error(`${repo} exists; a shift clones into a fresh scratch directory`)
  mkdirSync(config.scratch, { recursive: true })
  const reference = config.reference === undefined ? [] : ['--reference-if-able', config.reference]
  execFileSync('git', ['clone', '--quiet', '--branch', config.branch, '--single-branch', ...reference, config.remote, repo], { stdio: ['ignore', 'pipe', 'pipe'] })
  git(repo, 'config', 'user.name', 'Daliesk')
  git(repo, 'config', 'user.email', 'noreply@anthropic.com')
  // Every worktree shares this config: a department that pushes through
  // `origin` reaches nothing, and the shift pushes by the remote's own URL.
  git(repo, 'config', 'remote.origin.pushurl', 'no-push://a-department-does-not-push')
  return { repo, base: git(repo, 'rev-parse', 'HEAD') }
}

/** The display name of one seat, from the clone's roster. */
function seatName(repo: string, seat: string): string {
  const roster = JSON.parse(readFileSync(join(repo, ROSTER_PATH), 'utf8')) as Roster
  return roster.agents.find(agent => agent.id === seat)?.name ?? seat
}

/** The artefact the shift's two signatures attest: the selected tickets, verbatim. */
function artefactOf(tickets: readonly Ticket[]): string {
  return createHash('sha256').update(JSON.stringify(tickets)).digest('hex')
}

/**
 * The program of one shift: one department per ticket, certified on the
 * ticket's acceptance and the engine's three checks, and an integration that
 * repeats every ticket's acceptance over the merged head and gates the clean
 * tree.
 */
function programSpec(repo: string, tickets: readonly Ticket[], base: string, implementer: ImplementerKind): ProgramSpec {
  const merged: StandardCheck[] = tickets.flatMap(ticket => ticket.acceptance.map(check => ({
    id: `merged-${departmentKey(ticket.id)}-${check.id}` as CheckId,
    outcome: `acceptance ${check.id} of ${ticket.id} exits 0 on the merged head`,
    run: check.run,
  })))
  return {
    objective: `enterprise shift over ${tickets.map(ticket => ticket.id).join(', ')}`,
    baseRevision: base,
    signoff: { artefactSha256: artefactOf(tickets) },
    implementer: implementer === 'route' ? { kind: 'route' } : { kind: 'subagent', provider: SUBAGENT_PROVIDER, label: 'enterprise department' },
    goals: tickets.map(ticket => ({
      key: departmentKey(ticket.id),
      objective: departmentObjective(ticket, seatName(repo, ticket.seat)),
      preset: 'implementing',
      isolation: 'none',
      budget: { maxTotalTokens: ticket.budget.maxTotalTokens, maxWallMs: ticket.budget.maxWallMs },
      dependsOn: [],
      checks: ticketChecks(ticket, base),
    })),
    integration: {
      checks: merged,
      gates: ['test -z "$(git status --porcelain)"', `git diff --check ${base} HEAD`],
    },
  }
}

/**
 * Add every worktree of the program before it starts and install each from the
 * store, so a department's acceptance commands find the workspace installed
 * and the program reuses the directory it finds.
 */
function prepareWorktrees(repo: string, programId: string, keys: readonly string[], base: string): void {
  for (const key of [...keys, '@integration']) {
    const workspace = join(repo, programId, key)
    git(repo, 'worktree', 'add', '-B', `program/${programId}/${key}`, workspace, base)
    installOffline(workspace)
  }
}

/** Record the spec-freeze and release signatures on the program session before `start` opens it. */
async function sign(ctx: Awaited<ReturnType<typeof boot>>, spec: ProgramSpec, artefact: string, cwd: string): Promise<void> {
  const sessionId = SessionId(programIdFor(programSpecDigest(resolveProgramSpec(spec))))
  const signoffs = ctx.get('signoffs')
  const agents = ctx.get('agents')
  const model = ctx.get('agentDefaultModel')?.currentSelection()
  if (signoffs === undefined || agents === undefined || model === undefined) throw new Error('enterprise-shift driver requires the signoffs, agents and default-model services')
  const handle = await agents.create({ sessionId, meta: { cwd }, agentOptions: { provider: model.provider, model: model.model } })
  try {
    for (const transition of ['spec-freeze', 'release'] as const) {
      signoffs.record(handle.agent, {
        transition,
        principal: { kind: 'human', id: 'enterprise-operator', displayName: 'enterprise operator' },
        artefactSha256: artefact,
        evidence: [{ kind: 'spec', ref: 'the frozen shift program over the selected tickets' }],
      })
    }
    await ctx.sessions.flush(handle.agent.session)
  } finally {
    await handle.dispose()
  }
}

/** The text blocks of the last assistant message of one session, joined. */
function lastAnswer(events: readonly SessionEvent[]): string {
  const last = events.findLast(event => event.type === 'assistant/message')
  if (last === undefined) return ''
  return last.data.message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('')
}

/** Wall time one session log spans, in whole seconds. */
function spanSeconds(events: readonly SessionEvent[]): number {
  const first = events[0]?.time
  const last = events.at(-1)?.time
  return first === undefined || last === undefined ? 0 : Math.round((last - first) / 1000)
}

/**
 * Review one certified department in a session that never saw it: a fresh id,
 * no parent, no seed, the reviewing preset, no tool at all, an empty working
 * directory of its own, and a derived history of the standing instruction,
 * the ticket, and the evidence. The deployment's tools are global rows, so
 * the reviewer's scope restricts them all away: a reviewer with a shell could
 * read the department's worktree, which is exactly what it must not reach.
 * @param reviewRoot - the directory the reviewer's empty working directories are made under.
 */
async function review(
  ctx: Awaited<ReturnType<typeof boot>>,
  run: TicketRun,
  diff: string,
  commits: string,
  reviewRoot: string,
): Promise<{ verdict: 'approve' | 'reject'; sessionId: string; rationale: string; tokens: number; seconds: number }> {
  const agents = ctx.get('agents')
  const presets = ctx.get('agentPresets')
  const model = ctx.get('agentDefaultModel')?.currentSelection()
  if (agents === undefined || presets === undefined || model === undefined) throw new Error('enterprise-shift driver requires the agents, presets and default-model services')
  const sessionId = SessionId(`review-${run.key}-${randomBytes(4).toString('hex')}`)
  const cwd = join(reviewRoot, sessionId)
  mkdirSync(cwd, { recursive: true })
  const handle = await agents.create({
    sessionId,
    meta: { cwd },
    agentOptions: { provider: model.provider, model: model.model },
    setup: async (agentCtx) => {
      await presets.mount(agentCtx, REVIEW_PRESET)
      agentCtx.tools.restrict({ allow: [] })
    },
  })
  try {
    const message = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'enterprise-shift' } })
    handle.agent.inject(message(REVIEW_INSTRUCTION))
    handle.agent.inject(message(reviewTicketText(run.ticket)))
    handle.agent.followup(message(reviewEvidenceText(diff, commits, run.reviewed, REVIEW_TEXT_MAX_CHARS)))
    await handle.agent.whenIdle()
    const events = handle.agent.session.events
    const { verdict, rationale } = readReviewVerdict(lastAnswer(events), RATIONALE_MAX_CHARS)
    await ctx.sessions.flush(handle.agent.session)
    return { verdict, sessionId, rationale, tokens: foldBudgetSpend(events, {}).totalTokens, seconds: spanSeconds(events) }
  } finally {
    await handle.dispose()
  }
}

/**
 * The department's own outcome behind a program status: `merged` is the
 * program's integration over a certified department, and `running` is a
 * department the program left mid-pass, which this shift never resumes.
 */
function departmentOutcome(status: ProgramGoalOutcome['status']): DepartmentOutcome {
  switch (status) {
    case 'merged':
    case 'certified':
      return 'certified'
    case 'running':
    case 'failed':
      return 'failed'
    case 'pending':
    case 'blocked':
    case 'abandoned':
      return status
    default:
      return assertNeverStatus(status)
  }
}

function assertNeverStatus(status: never): never {
  throw new TypeError(`unhandled program goal status ${JSON.stringify(status)}`)
}

/** Fold one department's outcome, checks, spend and time out of its own session log. */
async function foldDepartment(persistence: SessionPersistence, run: TicketRun, goal: ProgramGoalOutcome): Promise<void> {
  run.outcome = departmentOutcome(goal.status)
  run.sessionId = goal.sessionId ?? null
  run.revision = goal.revision
  run.reason = goal.reason ?? ''
  if (goal.sessionId === undefined) return
  const { events } = await persistence.inspect(goal.sessionId)
  const lastRun = events.findLast(event => event.type === 'verification/run')
  if (lastRun !== undefined) {
    run.checks = lastRun.data.results.map(result => ({ id: result.checkId as string, ok: result.status === 'pass' }))
    run.reviewed = lastRun.data.results.map(result => ({ id: result.checkId as string, status: result.status, evidence: result.evidence }))
  }
  run.tokens = foldBudgetSpend(events, {}).totalTokens
  run.seconds = spanSeconds(events)
}

/** Every persisted session log, as `<session id>.jsonl` bodies, credential-shaped strings cut. */
function sessionLogs(root: string): { name: string; text: string; redacted: number }[] {
  if (!existsSync(root)) return []
  const logs: { name: string; text: string; redacted: number }[] = []
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name !== 'session.jsonl') continue
    const path = join(entry.parentPath, entry.name)
    const { text, redacted } = redactCredentials(readFileSync(path, 'utf8'))
    logs.push({ name: `${relative(root, entry.parentPath).split('/').at(-1) ?? 'session'}.jsonl`, text, redacted })
  }
  return logs.sort((left, right) => (left.name < right.name ? -1 : 1))
}

/** The ledger line one ticket run ends the shift with. */
function ledgerLine(
  run: TicketRun,
  at: string,
  shift: string,
  programId: string,
  implementer: ImplementerKind,
  model: string,
): TicketLedgerLine {
  return {
    type: 'ticket',
    at,
    shift,
    ticket: run.ticket.id,
    seat: run.ticket.seat,
    division: run.ticket.division,
    programId,
    implementer,
    model,
    department: { outcome: run.outcome, sessionId: run.sessionId },
    checks: run.checks,
    review: { verdict: run.review.verdict, sessionId: run.review.sessionId },
    integration: { outcome: run.integration },
    shipped: run.commit === null ? null : { commit: run.commit },
    reason: run.reason,
    tokens: run.tokens,
    seconds: run.seconds,
  }
}

/** The runs whose department was certified and whose review approved, in ticket order. */
function approved(runs: readonly TicketRun[]): TicketRun[] {
  return runs.filter(run => run.outcome === 'certified' && run.review.verdict === 'approve')
}

/**
 * Assemble the approved departments onto `base` in the clone's checkout: one
 * squash commit per ticket, in ticket order. A department whose squash
 * conflicts with what precedes it is reset away and recorded, and the rest
 * still assemble.
 * @returns the head after the last assembled commit, which is `base` when none did.
 */
function assemble(repo: string, base: string, runs: readonly TicketRun[], programId: string, trailers: CommitTrailers): string {
  git(repo, 'reset', '-q', '--hard', base)
  for (const run of runs) {
    if (run.revision === undefined || run.review.sessionId === null) continue
    const merged = tryGit(repo, 'merge', '--squash', run.revision)
    if (!merged.ok) {
      tryGit(repo, 'merge', '--abort')
      git(repo, 'reset', '-q', '--hard', 'HEAD')
      run.integration = 'conflict'
      run.reason = `the squash of ${run.revision} onto the assembled branch conflicted: ${merged.output.slice(-500)}`
      continue
    }
    const message = join(repo, '.git', `enterprise-${run.key}.msg`)
    writeFileSync(message, `${shippedCommitMessage(run.ticket, programId, run.sessionId ?? '', run.review.sessionId, trailers)}\n`)
    // The engine's own commits bypass the clone's git hooks: the change was
    // certified by the ticket's acceptance and the hooks are the contributor's.
    git(repo, 'commit', '-q', '--no-verify', '-F', message)
    run.commit = git(repo, 'rev-parse', 'HEAD')
    run.integration = 'merged'
    run.reason = 'approved and assembled'
  }
  return git(repo, 'rev-parse', 'HEAD')
}

/** Undo an assembly: every assembled ticket is not shipped for `reason`, and the checkout is back at `base`. */
function unship(repo: string, base: string, runs: readonly TicketRun[], outcome: IntegrationOutcome, reason: string): string {
  git(repo, 'reset', '-q', '--hard', base)
  for (const run of runs) {
    if (run.commit === null) continue
    run.commit = null
    run.integration = outcome
    run.reason = reason
  }
  return base
}

/**
 * Re-run every assembled ticket's acceptance over the assembled tree, which is
 * what a shipped commit is certified on.
 * @returns the first failing check as `<ticket> <check>: <output>`, or `undefined` when every check passed.
 */
function recertify(repo: string, runs: readonly TicketRun[]): string | undefined {
  installOffline(repo)
  for (const run of runs) {
    if (run.commit === null) continue
    for (const check of run.ticket.acceptance) {
      const result = runCheck(repo, check.run)
      if (!result.ok) return `${run.ticket.id} ${check.id}: ${result.output.slice(-1000)}`
    }
  }
  return undefined
}

/** Read the assembled commits back after a rebase moved them, in the order they were assembled. */
function rereadCommits(repo: string, base: string, runs: readonly TicketRun[]): void {
  const commits = git(repo, 'log', '--reverse', '--format=%H', `${base}..HEAD`).split('\n').filter(line => line !== '')
  const assembled = runs.filter(run => run.commit !== null)
  if (commits.length !== assembled.length) throw new Error(`expected ${assembled.length} assembled commits past ${base}, found ${commits.length}`)
  assembled.forEach((run, index) => {
    run.commit = commits[index] ?? null
  })
}

const startedAt = new Date()
const config = readConfig(startedAt)
const presetsDir = fileURLToPath(new URL('presets', import.meta.url))
const sessionsRoot = join(config.scratch, '.sessions')

// A host that configures git through `GIT_CONFIG_COUNT` hands every child a
// command-line config the shell seam cannot forward whole, and git then refuses
// every invocation, so the whole set is dropped rather than half of it.
for (const name of Object.keys(process.env)) {
  if (name.startsWith('GIT_CONFIG_')) Reflect.deleteProperty(process.env, name)
}

const { repo, base } = cloneTip(config)
const tickets = readQueue(repo, config.openPolicy ? OPEN_QUEUE_POLICY : HARNESS_QUEUE_POLICY)
const ledgerFile = join(repo, LEDGER_PATH)
const ledgerBefore = parseLedger(existsSync(ledgerFile) ? readFileSync(ledgerFile, 'utf8') : '')
const selected = selectTickets(tickets, ledgerBefore, config.selection)
if (selected.length === 0) {
  process.stdout.write(`${JSON.stringify({ type: 'result', shift: config.shift, base, selected: [], reason: 'no open ticket' })}\n`)
  if (!config.keep) rmSync(config.scratch, { recursive: true, force: true })
  process.exit(0)
}
const spec = programSpec(repo, selected, base, config.implementer)
const programId = programIdFor(programSpecDigest(resolveProgramSpec(spec)))
const runs: TicketRun[] = selected.map(ticket => ({
  ticket,
  key: departmentKey(ticket.id),
  outcome: 'pending',
  sessionId: null,
  revision: undefined,
  checks: [],
  reviewed: [],
  review: { verdict: 'none', sessionId: null, rationale: '' },
  integration: 'skipped',
  commit: null,
  reason: '',
  tokens: 0,
  seconds: 0,
}))
process.env['DSH_ENTERPRISE_REPO'] = repo
process.env['DSH_ENTERPRISE_SESSIONS'] = sessionsRoot
process.env['DSH_ENTERPRISE_PRESETS'] = presetsDir

/** A thrown value as a ledger reason states it. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Mark every run the shift never finished as failed for one reason. */
function failUnfinished(runs: readonly TicketRun[], reason: string): void {
  for (const run of runs) {
    if (run.outcome === 'certified') continue
    run.outcome = 'failed'
    run.integration = 'skipped'
    run.reason = reason
  }
}

let halt: Halt | undefined
let report: ProgramReport | undefined
let modelName = 'none'
let pushed: { commit: string; rounds: number } | null = null
let shipReason = ''
let head = base
let trailers: CommitTrailers = { coAuthor: 'Daliesk enterprise shift <noreply@anthropic.com>', session: CLAUDE_SESSION }

// A shift that cannot prepare its worktrees, or whose program throws, still
// records every ticket and pushes the record: an unattended schedule reads
// the ledger, not a process exit.
let prepared: string | undefined
try {
  prepareWorktrees(repo, programId, runs.map(run => run.key), base)
} catch (error: unknown) {
  prepared = describeError(error)
}
if (prepared !== undefined) {
  failUnfinished(runs, `the shift could not prepare its worktrees: ${prepared}`)
} else {
  const ctx = await boot('enterprise-shift', resolveConfigPath(configPath, undefined))
  try {
    await ctx.get('loader')?.await()
    const programs = ctx.get('programs')
    const persistence = ctx.get('sessionPersistence')
    const goals = ctx.get('goals')
    const agents = ctx.get('agents')
    const selection = ctx.get('agentDefaultModel')?.currentSelection()
    if (programs === undefined || persistence === undefined || goals === undefined || agents === undefined || selection === undefined) {
      throw new Error('enterprise-shift driver requires the programs, session persistence, goals, agents and default-model services')
    }
    const resolved = await ctx.get('llm')?.resolveModelInfo(selection.provider, selection.model)
    modelName = config.implementer === 'subagent' ? `Claude Code (${SUBAGENT_PROVIDER} subagent)` : resolved?.name ?? `${selection.provider}/${selection.model}`
    trailers = { coAuthor: `${modelName} <noreply@anthropic.com>`, session: CLAUDE_SESSION }

    // The first turn the route refuses with the seam's QUOTA code halts the
    // shift: the department's goal is blocked so its attempt ends without a
    // validation run, every later department blocks on its first refused turn,
    // and nothing past this point is reviewed, assembled, or pushed.
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'turn/end' || event.data.reason.kind !== 'error') return
      const failure = event.data.reason.error
      if (failure.code !== QUOTA_EXCEEDED_CODE) return
      halt ??= {
        kind: 'limit',
        sessionId: session.id,
        failure,
        resetsAt: failure.providerRetryAfterMs === undefined ? null : new Date(event.time + failure.providerRetryAfterMs).toISOString(),
      }
      const agent: Agent | undefined = agents.get(session.id)
      const goal = agent === undefined ? undefined : goals.get(agent)
      if (agent === undefined || goal === undefined || goal.phase !== 'active') return
      // The block is one more append to the session that is publishing this
      // event, so it waits for the publication to finish; it still lands before
      // the program reads the goal back after the turn.
      queueMicrotask(() => {
        try {
          goals.block(agent, { id: goal.id, revision: goal.revision }, { code: 'route-limit', message: `the route refused to serve: ${failure.message}` })
        } catch {
          // The goal moved between the read and the block; the halt is recorded either way.
        }
      })
    }, { global: true })

    try {
      await sign(ctx, spec, artefactOf(selected), repo)
      report = await programs.start(spec)
      for (const run of runs) {
        const goal = report.goals.find(candidate => candidate.key === run.key)
        if (goal !== undefined) await foldDepartment(persistence, run, goal)
      }
    } catch (error: unknown) {
      failUnfinished(runs, `the shift's program failed: ${describeError(error)}`)
    }
    if (halt !== undefined) {
      const reset = halt.resetsAt === null ? 'no reset stated' : `resets at ${halt.resetsAt}`
      for (const run of runs) {
        if (run.outcome === 'certified') continue
        run.outcome = 'halted'
        run.integration = 'skipped'
        run.reason = `halted: limit (${reset}; ${halt.failure.message})`
      }
    }

    for (const run of runs) {
      if (run.outcome !== 'certified' || run.revision === undefined || halt !== undefined) continue
      try {
        const diff = git(repo, 'diff', base, run.revision)
        const commits = git(repo, 'log', '--format=%H%n%B', `${base}..${run.revision}`)
        const reviewed = await review(ctx, run, diff, commits, join(config.scratch, 'review'))
        run.review = { verdict: reviewed.verdict, sessionId: reviewed.sessionId, rationale: reviewed.rationale }
        run.tokens += reviewed.tokens
        run.seconds += reviewed.seconds
        run.reason = `${reviewed.verdict}: ${reviewed.rationale}`
        if (reviewed.verdict === 'reject') run.integration = 'not-shipped'
      } catch (error: unknown) {
        run.integration = 'not-shipped'
        run.reason = `the review failed: ${describeError(error)}`
      }
    }
    for (const run of runs) {
      if (run.outcome === 'certified' && run.review.verdict === 'approve' && halt !== undefined) {
        run.integration = 'skipped'
        run.reason = 'halted: limit; certified and approved before the halt but not assembled'
      }
    }

    // The shift's integration: the approved departments squashed onto the base
    // in ticket order, the program's merged tree when it stands for the same set,
    // then every shipped ticket's acceptance over the assembled tree.
    const candidates = halt === undefined ? approved(runs) : []
    if (candidates.length > 0) {
      try {
        head = assemble(repo, base, candidates, programId, trailers)
        const assembled = candidates.filter(run => run.commit !== null)
        if (report?.mergedRevision !== undefined && assembled.length === runs.length) {
          const [assembledTree, mergedTree] = [git(repo, 'rev-parse', 'HEAD^{tree}'), git(repo, 'rev-parse', `${report.mergedRevision}^{tree}`)]
          if (assembledTree !== mergedTree) {
            head = unship(repo, base, candidates, 'digest-mismatch', `the assembled tree ${assembledTree} is not the program's certified merged tree ${mergedTree}`)
          }
        }
        if (head !== base) {
          const failed = recertify(repo, candidates)
          if (failed !== undefined) head = unship(repo, base, candidates, 'checks-failed', `acceptance failed over the assembled tree: ${failed}`)
        }
      } catch (error: unknown) {
        // A git or install failure mid-assembly ships nothing and is recorded
        // on every candidate; the checkout is returned to the base.
        tryGit(repo, 'merge', '--abort')
        head = unship(repo, base, candidates, 'not-shipped', `the assembly failed: ${describeError(error)}`)
        for (const run of candidates) {
          if (run.integration !== 'not-shipped') run.integration = 'not-shipped'
          if (run.reason.startsWith('approve')) run.reason = `the assembly failed: ${describeError(error)}`
        }
      }
    }
  } finally {
    await ctx.fiber.dispose()
  }
}

// Finalize: the ledger lines and the record committed after the assembled
// commits, then the push. When the tip moved, the assembled commits are
// rebased onto it and recertified before the ledger is rewritten around their
// new hashes; a rebase that conflicts ships nothing and still records why.
const recordName = shiftRecordName(startedAt, config.shift)
const recordDir = join(repo, SHIFTS_DIR, recordName)
const composition = relative(fileURLToPath(new URL('../../../../..', import.meta.url)), configPath)
const finalize = async (assembledHead: string, shippedBase: string): Promise<string> => {
  git(repo, 'reset', '-q', '--hard', assembledHead)
  const at = new Date().toISOString()
  const lines = runs.map(run => ledgerLine(run, at, config.shift, programId, config.implementer, modelName))
  await mkdir(join(repo, 'data', 'enterprise'), { recursive: true })
  await appendFile(ledgerFile, `${lines.map(line => JSON.stringify(line)).join('\n')}\n`)
  rmSync(recordDir, { recursive: true, force: true })
  await mkdir(join(recordDir, 'sessions'), { recursive: true })
  const logs = sessionLogs(sessionsRoot)
  for (const log of logs) await writeFile(join(recordDir, 'sessions', log.name), log.text)
  const result = {
    type: 'result',
    shift: config.shift,
    startedAt: startedAt.toISOString(),
    base: shippedBase,
    remote: config.remote,
    branch: config.branch,
    implementer: config.implementer,
    model: modelName,
    programId,
    report: report ?? null,
    halt: halt ?? null,
    tickets: runs.map(run => ({
      ...ledgerLine(run, at, config.shift, programId, config.implementer, modelName),
      rationale: run.review.rationale,
    })),
    redacted: logs.reduce((sum, log) => sum + log.redacted, 0),
  }
  const resultText = redactCredentials(JSON.stringify(result, null, 2)).text
  await writeFile(join(recordDir, 'result.json'), `${resultText}\n`)
  const files = ['result.json', ...logs.map(log => `sessions/${log.name}`)].map((path) => {
    const bytes = readFileSync(join(recordDir, path))
    return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  })
  const manifest = {
    shift: config.shift,
    startedAt: startedAt.toISOString(),
    endedAt: at,
    base: shippedBase,
    branch: config.branch,
    composition,
    programId,
    files,
  }
  await writeFile(join(recordDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  git(repo, 'add', '-A', '--', 'data/enterprise')
  const message = join(repo, '.git', 'enterprise-shift.msg')
  writeFileSync(message, `${shiftCommitMessage(config.shift, runs.filter(run => run.commit !== null).map(run => run.ticket.id), trailers)}\n`)
  git(repo, 'commit', '-q', '--no-verify', '-F', message)
  return git(repo, 'rev-parse', 'HEAD')
}

let shippedBase = base
let shiftCommit = ''
// A finalize or push that throws leaves the clone in place with the work and
// prints what happened, so the next shift and its operator can read it.
try {
  shiftCommit = await finalize(head, shippedBase)
  if (config.push) {
    for (let round = 1; round <= PUSH_ROUNDS && pushed === null; round += 1) {
      git(repo, 'fetch', '--quiet', 'origin', config.branch)
      const tip = git(repo, 'rev-parse', 'FETCH_HEAD')
      if (tip !== shippedBase) {
        // The tip moved: rebase the assembled commits alone onto it, recertify
        // them there, and rewrite the ledger around their new hashes.
        if (head === shippedBase) {
          git(repo, 'reset', '-q', '--hard', tip)
          head = tip
        } else {
          git(repo, 'reset', '-q', '--hard', head)
          const rebased = tryGit(repo, 'rebase', tip)
          if (!rebased.ok) {
            tryGit(repo, 'rebase', '--abort')
            head = unship(repo, tip, runs, 'not-shipped', `the tip moved to ${tip} and the rebase conflicted: ${rebased.output.slice(-500)}`)
          } else {
            head = git(repo, 'rev-parse', 'HEAD')
            rereadCommits(repo, tip, runs)
            const failed = recertify(repo, runs)
            if (failed !== undefined) head = unship(repo, tip, runs, 'checks-failed', `the tip moved to ${tip}; acceptance failed over the rebased tree: ${failed}`)
          }
        }
        shippedBase = tip
        shiftCommit = await finalize(head, shippedBase)
      }
      const push = tryGit(repo, 'push', '--quiet', config.remote, `HEAD:refs/heads/${config.branch}`)
      if (push.ok) pushed = { commit: shiftCommit, rounds: round }
      else shipReason = `push round ${round} refused: ${push.output.slice(-500)}`
    }
  }
} catch (error: unknown) {
  const reason = `the shift could not finalize or push: ${describeError(error)}`
  process.stdout.write(`${JSON.stringify({ type: 'result', shift: config.shift, error: reason, repo, tickets: runs.map(run => ledgerLine(run, startedAt.toISOString(), config.shift, programId, config.implementer, modelName)) })}\n`)
  process.stderr.write(`enterprise-shift: ${reason}; the clone is kept at ${repo}\n`)
  process.exit(1)
}
process.stdout.write(`${JSON.stringify({
  type: 'result',
  shift: config.shift,
  record: `${SHIFTS_DIR}/${recordName}`,
  base: shippedBase,
  programId,
  model: modelName,
  report: report ?? null,
  halt: halt ?? null,
  tickets: runs.map(run => ({
    ...ledgerLine(run, startedAt.toISOString(), config.shift, programId, config.implementer, modelName),
    rationale: run.review.rationale,
  })),
  shiftCommit,
  pushed,
  pushReason: shipReason,
  repo,
})}\n`)
// A clone whose work was not pushed holds the only copy of it, so it stays.
const unpushed = config.push && pushed === null
if (!config.keep && !unpushed) rmSync(repo, { recursive: true, force: true })
else if (unpushed) process.stderr.write(`enterprise-shift: nothing was pushed; the clone is kept at ${repo}\n`)
if (halt !== undefined) process.exit(3)
if (config.push && pushed === null) process.exit(2)
