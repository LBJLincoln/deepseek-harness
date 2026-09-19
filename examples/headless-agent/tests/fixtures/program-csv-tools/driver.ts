#!/usr/bin/env node
/**
 * Driver of the csv-tools program: seed the git repository the program delivers
 * into with the specification, the command line and the committed test suite,
 * record the two signatures, run the three-department program to its release,
 * and print the ledger, the member sessions, the barrier refusals and the file
 * list of the merged tree.
 *
 * The same driver serves the keyless composition beside it and the Claude Code
 * overlay under `overlays/`: what changes between the two is the route the
 * departments are driven on, never the spec, so both runs carry one program id.
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { programIdFor, programSpecDigest, resolveProgramSpec } from '@deepseek-ai/dsh-program'
import type { ProgramReport, ProgramSpec } from '@deepseek-ai/dsh-program'
import type {} from '@deepseek-ai/dsh-read-barrier'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-signoff'
import type { CheckId } from '@deepseek-ai/dsh-verification/types'

/** The artefact both of the program's signatures attest: the frozen specification. */
const ARTEFACT = 'c'.repeat(64)

/** Caps every department session runs under. */
const BUDGET = { maxTotalTokens: 2_000_000, maxWallMs: 1_500_000 }

/** The check every department carries: a department installs nothing. */
const NO_DEPENDENCIES = 'test ! -e node_modules'

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

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('csv-tools driver requires a config path')

const repository = process.env.DSH_TEST_PROGRAM_REPO
if (repository === undefined) throw new Error('csv-tools driver requires DSH_TEST_PROGRAM_REPO')

// The roster's root has to be absolute and the smoke runs in an isolated
// temporary cwd, so the presets beside this file are exported by path.
process.env.DSH_TEST_PROGRAM_PRESETS = fileURLToPath(new URL('presets', import.meta.url))

// A host that configures git through `GIT_CONFIG_COUNT` hands every child a
// command-line config the shell seam cannot forward whole, and git then refuses
// every invocation. This fixture runs against its own repository, so it drops
// the whole set rather than inheriting half of it.
for (const name of Object.keys(process.env)) {
  if (name.startsWith('GIT_CONFIG_')) Reflect.deleteProperty(process.env, name)
}

/**
 * Create the repository the program delivers into, once: the specification, the
 * command line and the test suite of `seed/`, committed and tagged `base`.
 * @param root - where the repository is minted.
 */
function ensureRepository(root: string): void {
  if (existsSync(join(root, '.git'))) return
  mkdirSync(root, { recursive: true })
  cpSync(fileURLToPath(new URL('seed', import.meta.url)), root, { recursive: true })
  const git = (...args: string[]): void => void execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  git('init', '-q', '.')
  git('config', 'user.email', 'csv-tools@example.test')
  git('config', 'user.name', 'csv-tools program')
  git('add', '-A')
  git('commit', '-qm', 'the csv-tools specification, command line and test suite')
  git('tag', 'base')
}

/**
 * The program the fixture runs: the parser and `stats` first, then `filter` and
 * `join`, then one integration over the merged head.
 * @returns the spec, which is frozen and digested before anything runs.
 */
function programSpec(): ProgramSpec {
  const department = (key: string, files: string, delivers: string, suite: string): ProgramSpec['goals'][number] => ({
    key,
    objective: [
      `csv-tools department: ${key}.`,
      'Read `SPEC.md` at the root of this worktree first: it is the whole specification and the only one.',
      `Deliver ${files} — ${delivers} — exactly as \`SPEC.md\` states them, then commit.`,
      'Do not change `bin/csv-tools.js` or anything under `test/`, and install nothing.',
      `Your work is measured by \`${suite}\` over a clean worktree, so commit before you stop.`,
    ].join(' '),
    preset: 'implementing',
    isolation: 'none',
    budget: BUDGET,
    dependsOn: key === 'stats' ? [] : ['stats'],
    checks: [
      { id: `${key}-suite` as CheckId, outcome: `the committed suite for ${key} passes`, run: suite },
      { id: `${key}-no-dependencies` as CheckId, outcome: 'nothing was installed', run: NO_DEPENDENCIES },
    ],
  })
  return {
    objective: 'deliver csv-tools: a zero-dependency command line with stats, filter and join subcommands',
    baseRevision: 'base',
    signoff: { artefactSha256: ARTEFACT },
    goals: [
      department(
        'stats',
        '`src/csv.js` and `src/stats.js`',
        'the reader and writer every subcommand is built on, and the `stats` subcommand',
        'node --test test/csv.test.js test/stats.test.js',
      ),
      department('filter', '`src/filter.js`', 'the `filter` subcommand', 'node --test test/filter.test.js'),
      department('join', '`src/join.js`', 'the `join` subcommand', 'node --test test/join.test.js'),
    ],
    integration: {
      // Only the merged head carries all four modules, so only the merged head
      // passes `test/cli.test.js` — the suite that drives the real command line.
      checks: [{
        id: 'csv-tools-suite' as CheckId,
        outcome: 'the merged head passes every committed suite, including the command line end to end',
        run: 'node --test test/*.test.js',
      }],
      // The commit-or-refuse rule, carried into the certificate rather than
      // only into the program's own refusal to measure a dirty worktree.
      gates: ['test -z "$(git status --porcelain)"', NO_DEPENDENCIES],
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
  if (signoffs === undefined || agents === undefined) throw new Error('csv-tools driver requires the signoffs and agents services')
  if ((await ctx.get('sessionPersistence')?.list() ?? []).some(stored => stored.id === sessionId)) return
  const model = ctx.get('agentDefaultModel')?.currentSelection()
  if (model === undefined) throw new Error('csv-tools driver requires the default-model service')
  const handle = await agents.create({
    sessionId,
    meta: { cwd },
    agentOptions: { provider: model.provider, model: model.model },
  })
  try {
    for (const transition of ['spec-freeze', 'release'] as const) {
      signoffs.record(handle.agent, {
        transition,
        principal: { kind: 'human', id: 'csv-tools-client', displayName: 'csv-tools client' },
        artefactSha256: ARTEFACT,
        evidence: [{ kind: 'spec', ref: 'the frozen csv-tools program spec' }],
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

// The repository has to exist before the program plugin validates its
// workspaceRoot, so it is minted before the composition loads.
ensureRepository(repository)

const ctx = await boot('csv-tools-program', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the program mounts presets and reads
  // persisted sessions, so the driver drives only the settled application.
  await ctx.get('loader')?.await()
  const programs = ctx.get('programs')
  const persistence = ctx.get('sessionPersistence')
  if (programs === undefined || persistence === undefined) throw new Error('csv-tools driver requires the programs and session persistence services')
  const denials: DenialLine[] = []
  ctx.on('session/event', (session, event) => {
    if (event.type === 'read-barrier/denied') {
      denials.push({ sessionId: session.id, capability: event.data.capability, displayPath: event.data.displayPath })
    }
  }, { global: true })
  const spec = programSpec()
  await sign(ctx, spec, repository)
  const report = await programs.start(spec)
  const observed = await readRoot(persistence)
  process.stdout.write(`${JSON.stringify({
    type: 'result',
    report,
    denials,
    deliverable: deliverable(repository, report),
    ...observed,
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
