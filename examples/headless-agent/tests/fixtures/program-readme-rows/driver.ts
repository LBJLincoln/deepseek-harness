#!/usr/bin/env node
/**
 * Driver of the readme-rows program: seed the git repository the program
 * delivers into with the task statement, the records and the committed rows —
 * or accept a clone of this repository prepared the same way — record the two
 * signatures, run the one-department program to its release, and print the
 * ledger, the member sessions, the barrier refusals and the file list of the
 * merged tree.
 *
 * The same driver serves the keyless composition beside it and the Claude Code
 * overlay under `overlays/`: what changes between the two is the route the
 * department is driven on and the repository it delivers into, never the spec,
 * so both runs carry one program id.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
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
import type { CheckId, StandardCheck } from '@deepseek-ai/dsh-verification/types'

/** The task statement every department reads first, at the root of its worktree. */
const TASK = 'TASK.md'

/** The artefact both of the program's signatures attest: the task statement the seed carries. */
const ARTEFACT = createHash('sha256').update(readFileSync(new URL(`seed/${TASK}`, import.meta.url))).digest('hex')

/** Caps the department session runs under. */
const BUDGET = { maxTotalTokens: 2_000_000, maxWallMs: 1_500_000 }

/** The check every department carries: a department installs nothing. */
const NO_DEPENDENCIES = 'test ! -e node_modules'

/** The tool the department delivers, and the test beside it. */
const TOOL = 'data/proving-ground/tools/readme-rows.mjs'
const TEST = 'data/proving-ground/tools/readme-rows.test.mjs'

/** The two trailer lines every commit of the program ends with. */
const TRAILERS = [
  'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>',
  'Claude-Session: https://claude.ai/code/session_01HEXjzxR7CyMizem5kFAB4C',
]

/** One committed row set the delivered tool must reproduce byte for byte. */
interface Golden {
  /** Check id suffix, lower-kebab-case. */
  readonly id: string
  /** Record directory name under `data/proving-ground/`. */
  readonly record: string
  readonly lang: 'en' | 'zh'
  /** The record's hand-written Implementer column, with `{model}` where the row's model goes. */
  readonly implementer: string
}

/** The five goldens: both languages of the fleet pair, English of the tier-6 sweep, both of the frozen pair. */
const GOLDENS: readonly Golden[] = [
  {
    id: 'hidden-pair-en',
    record: '2026-09-26-bench-completion-hidden-pair',
    lang: 'en',
    implementer: '`route` (harness loop on `claude-code`/`{model}`), sealed, completion family',
  },
  {
    id: 'hidden-pair-zh',
    record: '2026-09-26-bench-completion-hidden-pair',
    lang: 'zh',
    implementer: '`route`（harness 循环，走 `claude-code`/`{model}`），密封，补全任务族',
  },
  {
    id: 't6-haiku-en',
    record: '2026-09-26-bench-completion-t6-haiku',
    lang: 'en',
    implementer: '`route` (harness loop on `claude-code`/`{model}`), sealed, completion family',
  },
  {
    id: 'e12-en',
    record: '2026-09-27-bench-e12-self-review-sonnet-t5t6',
    lang: 'en',
    implementer: '`route`, `sonnet` on one rung vs `sonnet` on one rung `+review` (a self-review turn before the validation), sealed',
  },
  {
    id: 'e12-zh',
    record: '2026-09-27-bench-e12-self-review-sonnet-t5t6',
    lang: 'zh',
    implementer: '`route`，`sonnet` 单级梯 对 `sonnet` 单级梯 `+review`（验证前的一个自审回合），密封',
  },
]

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
if (configPath === undefined) throw new Error('readme-rows driver requires a config path')

const repository = process.env.DSH_TEST_PROGRAM_REPO
if (repository === undefined) throw new Error('readme-rows driver requires DSH_TEST_PROGRAM_REPO')

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
 * The repository the program delivers into. A path with no repository is
 * minted from `seed/`: the task statement, the three records, the committed
 * rows and `summarize-run.mjs`, committed and tagged `base`. A path that is a
 * repository already — a clone of this repository prepared for the real run —
 * is left untouched and must carry `TASK.md` at `base`, because the department
 * reads it first and the program cuts its worktree from that tag.
 * @param root - where the repository is, or is minted.
 */
function ensureRepository(root: string): void {
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' })
  if (existsSync(join(root, '.git'))) {
    try {
      git('cat-file', '-e', `base:${TASK}`)
    } catch {
      // git exits non-zero when the tag or the path is absent; either way the
      // repository was not prepared for this program.
      throw new Error(`${root} carries no ${TASK} at the tag base; copy seed/${TASK} to its root, commit it, and tag that commit base before starting the program`)
    }
    return
  }
  mkdirSync(root, { recursive: true })
  cpSync(fileURLToPath(new URL('seed', import.meta.url)), root, { recursive: true })
  git('init', '-q', '.')
  git('config', 'user.email', 'readme-rows@example.test')
  git('config', 'user.name', 'readme-rows program')
  git('add', '-A')
  git('commit', '-qm', 'the readme-rows task statement, three records and their committed rows')
  git('tag', 'base')
}

/**
 * The shell check that diffs the tool's rows for one record against the rows
 * committed for it, in the language's README.
 * @param golden - the record, language and Implementer column.
 * @param prefix - check id prefix distinguishing the department's standard from the integration's.
 * @returns the check, which passes exactly when `diff` prints nothing.
 */
function goldenCheck(golden: Golden, prefix: string): StandardCheck {
  const readme = golden.lang === 'zh' ? 'data/proving-ground/README.zh.md' : 'data/proving-ground/README.md'
  const rows = `node ${TOOL} data/proving-ground/${golden.record} --lang ${golden.lang} --implementer '${golden.implementer}'`
  return {
    id: `${prefix}-${golden.id}` as CheckId,
    outcome: `the ${golden.lang} rows of ${golden.record} are the committed ones, byte for byte`,
    run: `diff <(${rows}) <(grep -F '| [${golden.record}]' ${readme})`,
  }
}

/**
 * The check that runs the test the department writes beside the tool.
 * @param prefix - check id prefix.
 * @returns the check.
 */
function testCheck(prefix: string): StandardCheck {
  return { id: `${prefix}-test` as CheckId, outcome: 'the tool\'s own test passes', run: `node --test ${TEST}` }
}

/**
 * The program the fixture runs: one department that writes the tool and its
 * test against the committed rows, then one integration over the merged head
 * that repeats the goldens and gates the clean tree.
 * @returns the spec, which is frozen and digested before anything runs.
 */
function programSpec(): ProgramSpec {
  return {
    objective: 'deliver readme-rows: the tool that prints the README rows of one recorded Proving Ground run',
    baseRevision: 'base',
    signoff: { artefactSha256: ARTEFACT },
    goals: [{
      key: 'readme-rows',
      objective: [
        'readme-rows department.',
        `Read \`${TASK}\` at the root of this worktree first: it states the whole task and every check you are measured by.`,
        `Deliver \`${TOOL}\` and \`${TEST}\` exactly as \`${TASK}\` states them, install nothing, change nothing else, and commit before you stop: your work is measured over a clean worktree.`,
        `End every commit message with exactly these two trailer lines: \`${TRAILERS[0]}\` and \`${TRAILERS[1]}\`.`,
      ].join(' '),
      preset: 'implementing',
      isolation: 'none',
      budget: BUDGET,
      dependsOn: [],
      checks: [
        testCheck('readme-rows'),
        ...GOLDENS.map(golden => goldenCheck(golden, 'readme-rows')),
        { id: 'readme-rows-no-dependencies' as CheckId, outcome: 'nothing was installed', run: NO_DEPENDENCIES },
      ],
    }],
    integration: {
      checks: [testCheck('merged'), ...GOLDENS.map(golden => goldenCheck(golden, 'merged'))],
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
  if (signoffs === undefined || agents === undefined) throw new Error('readme-rows driver requires the signoffs and agents services')
  if ((await ctx.get('sessionPersistence')?.list() ?? []).some(stored => stored.id === sessionId)) return
  const model = ctx.get('agentDefaultModel')?.currentSelection()
  if (model === undefined) throw new Error('readme-rows driver requires the default-model service')
  const handle = await agents.create({
    sessionId,
    meta: { cwd },
    agentOptions: { provider: model.provider, model: model.model },
  })
  try {
    for (const transition of ['spec-freeze', 'release'] as const) {
      signoffs.record(handle.agent, {
        transition,
        principal: { kind: 'human', id: 'readme-rows-operator', displayName: 'readme-rows operator' },
        artefactSha256: ARTEFACT,
        evidence: [{ kind: 'spec', ref: `the frozen readme-rows program spec over seed/${TASK}` }],
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

const ctx = await boot('readme-rows-program', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the program mounts presets and reads
  // persisted sessions, so the driver drives only the settled application.
  await ctx.get('loader')?.await()
  const programs = ctx.get('programs')
  const persistence = ctx.get('sessionPersistence')
  if (programs === undefined || persistence === undefined) throw new Error('readme-rows driver requires the programs and session persistence services')
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
