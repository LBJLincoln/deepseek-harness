#!/usr/bin/env node
/**
 * Driver of the code-safety program: lock the target tree, seed the report
 * repository the program delivers into with the examiner and the reporting
 * contract, record the two signatures, run the six security departments and
 * their integration to a release, and print the ledger, the member sessions,
 * the released report and the examiner's own verdict over the merged head.
 *
 * The program never delivers into the target. Departments read it and write
 * their findings into their own worktree of the report repository, and the
 * `target.json` the base commit carries is what makes "read-only" checkable:
 * the committed examiner re-hashes every locked file on every run.
 *
 * The same driver serves the keyless composition beside it and the Claude Code
 * overlay under `overlays/`: what changes between the two is the route the
 * departments are driven on and the target they are pointed at, never the
 * spec's shape, so a run is comparable with the one before it.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { INTEGRATION_KEY, programIdFor, programSpecDigest, resolveProgramSpec } from '@deepseek-ai/dsh-program'
import type { ProgramReport, ProgramSpec } from '@deepseek-ai/dsh-program'
import type {} from '@deepseek-ai/dsh-read-barrier'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-signoff'
import type { CheckId } from '@deepseek-ai/dsh-verification/types'

/** The artefact both of the program's signatures attest: the frozen specification. */
const ARTEFACT = '5afe'.repeat(16)

/** Caps every department session runs under. */
const BUDGET = { maxTotalTokens: 4_000_000, maxWallMs: 2_400_000 }

/** Directory names the target lock never descends into. */
const EXCLUDE = ['.git']

/**
 * Files a target tree may hold before this driver refuses to lock it. The lock
 * is what makes the target's read-only claim checkable, so a tree too large to
 * hash is refused rather than sampled: a sampled lock would report a target
 * unchanged that a department had edited outside the sample.
 */
const MAX_TARGET_FILES = 5000

/** One locked target tree, committed in the report repository's base commit. */
interface TargetLock {
  /** Absolute path of the tree under review on this host. */
  readonly root: string
  /** Directory names the walk skipped, which the examiner skips too. */
  readonly exclude: readonly string[]
  /** SHA-256 over every locked path and digest, which the report's certificate states. */
  readonly sha256: string
  /** Relative path to SHA-256 for every file under review. */
  readonly files: Record<string, string>
}

/** One program session's ledger as the e2e asserts on it. */
interface LedgerLine {
  readonly sessionId: string
  readonly events: { readonly type: string; readonly data: unknown }[]
  /** Transitions the same session was signed for, in log order. */
  readonly signoffs: string[]
}

/** One recorded run of a member session's own standard. */
interface RunLine {
  readonly attempt: number
  readonly verdict: string
  readonly results: { readonly checkId: string; readonly status: string }[]
}

/** One member session's stamp, caps, runs and certificate. */
interface MemberLine {
  readonly sessionId: string
  readonly programId: string
  readonly key: string
  readonly certified: boolean
  readonly caps: unknown
  readonly runs: RunLine[]
  /** Root causes the validator addressed to this session, in log order. */
  readonly directives: string[]
}

/** One refusal the read barrier recorded. */
interface DenialLine {
  readonly sessionId: string
  readonly capability: string
  readonly displayPath: string
}

/** What the committed examiner said about the released tree, run again by this driver. */
interface VerifierLine {
  readonly exitCode: number
  readonly output: string
}

/** What one department looks for, and the marker its session is recognised by. */
interface Department {
  readonly key: string
  /** One line naming the department's subject, which opens its objective. */
  readonly subject: string
  /** What the department reads the target for, stated as the goal's own instruction. */
  readonly instruction: string
}

const DEPARTMENTS: readonly Department[] = [
  {
    key: 'secrets',
    subject: 'hard-coded credentials and leaked configuration',
    instruction: 'Look for credentials, tokens, private keys, connection strings and API keys written as literals in source or configuration, for secrets committed in `.env`, config or deployment files, and for secrets reaching logs or client-side bundles. Name the exact literal line; do not report a placeholder a reader can see is one without saying so.',
  },
  {
    key: 'injection',
    subject: 'injection and traversal',
    instruction: 'Look for SQL and NoSQL queries built by concatenation or interpolation, for `$where` and other server-side evaluation, for `eval`, `new Function` and string-bodied timers, for shell commands built from request data, for template injection, for unescaped HTML sinks, and for filesystem paths built from request data. Name the sink line, and say in `evidence` what reaches it.',
  },
  {
    key: 'access',
    subject: 'authentication, session handling and authorization',
    instruction: 'Look for routes that change or read data without an authentication or authorization check, for direct object references taken from the request, for session configuration that does not regenerate or expire, for missing CSRF protection on state-changing routes, and for privilege changes a user can request for themselves. Name the route line that is missing the check.',
  },
  {
    key: 'data',
    subject: 'sensitive data exposure, logging and cryptography',
    instruction: 'Look for personal data, credentials or tokens written to logs or error responses, for cleartext transport, for password storage that is not a memory-hard or iterated hash, for broken hashes and ciphers, and for secrets or personal data returned to the client. Name the line that discloses or weakly protects the data.',
  },
  {
    key: 'dependencies',
    subject: 'vulnerable and outdated dependencies',
    instruction: 'Read the manifest and, when a lockfile is present, run `npm audit --json` in the target and read what it reports. Report the declared version and the advisory identifier — the GHSA or CVE — for each vulnerable package. `file` and `line` are the manifest line that declares the dependency, and `snippet` is that line. When the audit cannot reach the registry, say so in your report section and fall back to the declared versions.',
  },
  {
    key: 'platform',
    subject: 'security misconfiguration and the web platform',
    instruction: 'Look for missing or weak security headers, permissive CORS, cookies without `httpOnly`, `secure` or `sameSite`, error handlers that return stack traces, missing rate limiting on authentication routes, debug or development settings left enabled, and client-side code that trusts the URL or the DOM. Name the configuration line.',
  },
]

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('code-safety driver requires a config path')

const reportRepository = process.env.DSH_CODE_SAFETY_REPORT_REPO
if (reportRepository === undefined) throw new Error('code-safety driver requires DSH_CODE_SAFETY_REPORT_REPO')

const targetRoot = process.env.DSH_CODE_SAFETY_TARGET
if (targetRoot === undefined) throw new Error('code-safety driver requires DSH_CODE_SAFETY_TARGET')
const target = resolve(targetRoot)
if (!existsSync(target)) throw new Error(`code-safety driver: the target tree ${target} is not on this host`)

// The roster's root has to be absolute and the smoke runs in an isolated
// temporary cwd, so the presets and the scanner rules beside this file are
// exported by path.
process.env.DSH_CODE_SAFETY_PRESETS = fileURLToPath(new URL('presets', import.meta.url))
const semgrepRules = fileURLToPath(new URL('semgrep', import.meta.url))

// A host that configures git through `GIT_CONFIG_COUNT` hands every child a
// command-line config the shell seam cannot forward whole, and git then refuses
// every invocation. This fixture runs against its own repository, so it drops
// the whole set rather than inheriting half of it.
for (const name of Object.keys(process.env)) {
  if (name.startsWith('GIT_CONFIG_')) Reflect.deleteProperty(process.env, name)
}

/**
 * Every file under one directory, relative and sorted, skipping {@link EXCLUDE}.
 * @param root - the tree to walk.
 * @returns the relative paths, sorted.
 */
function walk(root: string): string[] {
  const found: string[] = []
  const descend = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!EXCLUDE.includes(entry.name)) descend(path)
      } else if (entry.isFile()) found.push(relative(root, path))
    }
  }
  descend(root)
  return found.sort()
}

/**
 * Lock the tree under review: every file's digest, and one digest over all of
 * them. The lock is committed before any department starts, so a department
 * that wrote into the target fails the examiner rather than passing it.
 * @param root - the absolute target root.
 * @returns the lock the base commit carries.
 * @throws when the tree holds more files than {@link MAX_TARGET_FILES}.
 */
function lockTarget(root: string): TargetLock {
  const paths = walk(root)
  if (paths.length > MAX_TARGET_FILES) {
    throw new Error(`code-safety driver: ${root} holds ${String(paths.length)} files, above the ${String(MAX_TARGET_FILES)} this driver locks`)
  }
  const files: Record<string, string> = {}
  const whole = createHash('sha256')
  for (const path of paths) {
    const digest = createHash('sha256').update(readFileSync(join(root, path))).digest('hex')
    files[path] = digest
    whole.update(`${path}\0${digest}\n`)
  }
  return { root, exclude: EXCLUDE, sha256: whole.digest('hex'), files }
}

/**
 * Create the report repository, once: the reporting contract, the committed
 * examiner and the target lock, committed and tagged `base`.
 * @param root - where the repository is minted.
 * @param lock - the locked target tree the base commit carries.
 */
function ensureRepository(root: string, lock: TargetLock): void {
  if (existsSync(join(root, '.git'))) return
  mkdirSync(root, { recursive: true })
  cpSync(fileURLToPath(new URL('seed', import.meta.url)), root, { recursive: true })
  writeFileSync(join(root, 'target.json'), `${JSON.stringify(lock, null, 2)}\n`)
  const git = (...args: string[]): void => void execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  git('init', '-q', '.')
  git('config', 'user.email', 'code-safety@example.test')
  git('config', 'user.name', 'code-safety program')
  git('add', '-A')
  git('commit', '-qm', 'the reporting contract, the committed examiner and the locked target tree')
  git('tag', 'base')
}

/**
 * The program the fixture runs: six departments reading one target tree in
 * parallel, then one integration over the merged head.
 * @param lock - the locked target, whose root and size every objective states.
 * @returns the spec, which is frozen and digested before anything runs.
 */
function programSpec(lock: TargetLock): ProgramSpec {
  const locked = String(Object.keys(lock.files).length)
  const department = ({ key, subject, instruction }: Department): ProgramSpec['goals'][number] => ({
    key,
    objective: [
      `code-safety department: ${key} — ${subject}.`,
      'Read `REPORTING.md` at the root of this worktree first: it states the finding format, the evidence rule and what you deliver.',
      `The tree under review is ${lock.root}; it holds ${locked} files, and \`target.json\` beside \`REPORTING.md\` lists every one of them.`,
      'It is read-only: read it, grep it, scan it, and write nothing into it.',
      `Before reading, run \`semgrep --version\`; if it prints a version, run \`semgrep --config ${semgrepRules} --config p/owasp-top-ten --metrics off --json <path>\` over the target (drop the registry pack and keep the local rules if the registry is unreachable) and treat every hit as a place to read, never as a finding; if semgrep is absent, say so in your report and read without it.`,
      instruction,
      `Deliver \`findings/${key}.json\` and \`report/${key}.md\`, then commit.`,
      `Your work is measured by \`node verify-safety-report.mjs --findings findings/${key}.json\` over a clean worktree, so run it and commit before you stop.`,
    ].join(' '),
    preset: key,
    isolation: 'none',
    budget: BUDGET,
    dependsOn: [],
    checks: [
      {
        id: `${key}-findings` as CheckId,
        outcome: `every finding ${key} reported exists at the line it cites`,
        run: `node verify-safety-report.mjs --findings findings/${key}.json`,
      },
      {
        id: `${key}-section` as CheckId,
        outcome: `${key} wrote its own section of the report`,
        run: `test -s report/${key}.md`,
      },
    ],
  })
  return {
    objective: `review ${lock.root} for code-safety defects and deliver one verified report`,
    baseRevision: 'base',
    signoff: { artefactSha256: ARTEFACT },
    goals: DEPARTMENTS.map(department),
    integration: {
      // The committed examiner decides the release: every finding of the union
      // resolves in the target, every dropped one is disclosed, and the report
      // claims no more than that.
      checks: [{
        id: 'safety-report' as CheckId,
        outcome: 'the merged report and its union of findings pass the committed examiner',
        run: 'node verify-safety-report.mjs --report',
      }],
      // The commit-or-refuse rule, carried into the certificate rather than
      // only into the program's own refusal to measure a dirty worktree.
      gates: ['test -z "$(git status --porcelain)"', 'test -s SAFETY-REPORT.md'],
    },
  }
}

/**
 * Record the spec-freeze and release signatures on the program session, the way
 * a client district's signer would before the program starts. A session that
 * already carries them is left alone, so a resumed run signs nothing twice.
 * @param ctx - the booted application.
 * @param spec - the spec whose digest names the program session.
 * @param cwd - the repository the signing session is opened over.
 */
async function sign(ctx: Awaited<ReturnType<typeof boot>>, spec: ProgramSpec, cwd: string): Promise<void> {
  const sessionId = SessionId(programIdFor(programSpecDigest(resolveProgramSpec(spec))))
  const signoffs = ctx.get('signoffs')
  const agents = ctx.get('agents')
  if (signoffs === undefined || agents === undefined) throw new Error('code-safety driver requires the signoffs and agents services')
  if ((await ctx.get('sessionPersistence')?.list() ?? []).some(stored => stored.id === sessionId)) return
  const model = ctx.get('agentDefaultModel')?.currentSelection()
  if (model === undefined) throw new Error('code-safety driver requires the default-model service')
  const handle = await agents.create({
    sessionId,
    meta: { cwd },
    agentOptions: { provider: model.provider, model: model.model },
  })
  try {
    for (const transition of ['spec-freeze', 'release'] as const) {
      signoffs.record(handle.agent, {
        transition,
        principal: { kind: 'human', id: 'code-safety-client', displayName: 'code-safety client' },
        artefactSha256: ARTEFACT,
        evidence: [{ kind: 'spec', ref: 'the frozen code-safety program spec' }],
      })
    }
    await ctx.sessions.flush(handle.agent.session)
  } finally {
    await handle.dispose()
  }
}

/**
 * Every program ledger and every member session in the persistence root.
 * @param persistence - the backend the composition mounted.
 * @returns the ledgers and the member lines the e2e asserts on.
 */
async function readRoot(persistence: SessionPersistence): Promise<{ ledgers: LedgerLine[]; members: MemberLine[] }> {
  const ledgers: LedgerLine[] = []
  const members: MemberLine[] = []
  for (const stored of await persistence.list()) {
    const { events } = await persistence.inspect(stored.id)
    const programEvents = events.filter((event: SessionEvent) => event.type.startsWith('program/') && event.type !== 'program/member')
    if (programEvents.length > 0) {
      ledgers.push({
        sessionId: stored.id,
        events: programEvents.map(event => ({ type: event.type, data: event.data })),
        signoffs: events.flatMap(event => (event.type === 'signoff/recorded' ? [event.data.transition] : [])),
      })
    }
    for (const event of events) {
      if (event.type !== 'program/member') continue
      members.push({
        sessionId: stored.id,
        programId: event.data.programId,
        key: event.data.key,
        certified: events.some(candidate => candidate.type === 'verification/certificate'),
        caps: events.find(candidate => candidate.type === 'budget/caps')?.data,
        runs: events.flatMap(candidate => (candidate.type === 'verification/run'
          ? [{
            attempt: candidate.data.attempt,
            verdict: candidate.data.verdict,
            results: candidate.data.results.map(result => ({ checkId: result.checkId as string, status: result.status })),
          }]
          : [])),
        directives: events.flatMap(candidate => (candidate.type === 'verification/directive' ? [candidate.data.rootCause] : [])),
      })
    }
  }
  return { ledgers, members }
}

/**
 * One file of the released tree.
 * @param root - the repository the program delivered into.
 * @param revision - the merged head, or undefined for a program that released none.
 * @param path - the path to read out of that tree.
 * @returns the file's text, or an empty string when the tree does not carry it.
 */
function released(root: string, revision: string | undefined, path: string): string {
  if (revision === undefined) return ''
  try {
    return execFileSync('git', ['show', `${revision}:${path}`], { cwd: root, encoding: 'utf8' })
  } catch {
    // A failed integration releases no tree to read; the ledger states why, and
    // the empty text is what a reader of this line gets.
    return ''
  }
}

/**
 * The files the released tree carries.
 * @param root - the repository the program delivered into.
 * @param report - the report whose merged revision is read.
 * @returns every path of the merged tree, sorted, or an empty list for a program that released none.
 */
function deliverable(root: string, report: ProgramReport): string[] {
  if (report.mergedRevision === undefined) return []
  const listed = execFileSync('git', ['ls-tree', '-r', '--name-only', report.mergedRevision], { cwd: root, encoding: 'utf8' })
  return listed.split('\n').filter(line => line !== '').sort()
}

/**
 * Run the committed examiner over the integration worktree once more, outside
 * the program, so the recorded run carries a verdict this driver observed
 * rather than one it read out of a certificate.
 * @param workspace - the integration worktree.
 * @returns the examiner's exit code and what it wrote.
 */
function examine(workspace: string): VerifierLine {
  if (!existsSync(join(workspace, 'verify-safety-report.mjs'))) return { exitCode: -1, output: 'no integration worktree' }
  try {
    const output = execFileSync(process.execPath, ['verify-safety-report.mjs', '--report'], { cwd: workspace, encoding: 'utf8', stdio: 'pipe' })
    return { exitCode: 0, output }
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string }
    return { exitCode: failed.status ?? -1, output: `${failed.stdout ?? ''}${failed.stderr ?? ''}` }
  }
}

// The report repository has to exist before the program plugin validates its
// workspaceRoot, so it is minted — and the target locked — before the
// composition loads.
const lock = lockTarget(target)
ensureRepository(reportRepository, lock)

const ctx = await boot('code-safety-program', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the program mounts presets and reads
  // persisted sessions, so the driver drives only the settled application.
  await ctx.get('loader')?.await()
  const programs = ctx.get('programs')
  const persistence = ctx.get('sessionPersistence')
  if (programs === undefined || persistence === undefined) throw new Error('code-safety driver requires the programs and session persistence services')
  const denials: DenialLine[] = []
  ctx.on('session/event', (session, event) => {
    if (event.type === 'read-barrier/denied') {
      denials.push({ sessionId: session.id, capability: event.data.capability, displayPath: event.data.displayPath })
    }
  }, { global: true })
  const spec = programSpec(lock)
  await sign(ctx, spec, reportRepository)
  const started = Date.now()
  const report = await programs.start(spec)
  const observed = await readRoot(persistence)
  const integration = join(reportRepository, report.programId, INTEGRATION_KEY)
  process.stdout.write(`${JSON.stringify({
    type: 'result',
    report,
    target: { root: lock.root, files: Object.keys(lock.files).length, sha256: lock.sha256 },
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
    denials,
    deliverable: deliverable(reportRepository, report),
    safetyReport: released(reportRepository, report.mergedRevision, 'SAFETY-REPORT.md'),
    findings: released(reportRepository, report.mergedRevision, 'findings.json'),
    verifier: examine(integration),
    ...observed,
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
