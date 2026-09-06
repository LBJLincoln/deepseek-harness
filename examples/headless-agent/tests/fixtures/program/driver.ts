#!/usr/bin/env node
/**
 * Test driver: create the temporary git repository the program delivers into,
 * boot the program composition, run one two-goal program with a dependency to
 * its release, and print every program ledger plus the member stamps the
 * department and integration sessions left in the persistence root.
 *
 * With `DSH_TEST_PROGRAM_KILL_AFTER_CERTIFIED` set, the driver instead exits
 * hard the moment the ledger records the first department as certified — the
 * department's own certificate is durable by then, while the program session
 * may or may not have recorded it, which is exactly the state the next boot
 * reconciles.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { ProgramSpec } from '@deepseek-ai/dsh-program'
import type {} from '@deepseek-ai/dsh-program'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { CheckId } from '@deepseek-ai/dsh-verification/types'

/** Exit code the kill switch leaves behind, distinct from every clean exit. */
const KILLED = 9

/** One program session's ledger as the e2e asserts on it. */
interface LedgerLine {
  readonly sessionId: string
  readonly events: { readonly type: string; readonly data: unknown }[]
}

/** One member session's stamp as the e2e asserts on it. */
interface MemberLine {
  readonly sessionId: string
  readonly programId: string
  readonly key: string
  /** Whether the member's own log carries a certificate. */
  readonly certified: boolean
  /** The caps the member session recorded for itself. */
  readonly caps: unknown
}

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('program driver requires a config path')

const repository = process.env.DSH_TEST_PROGRAM_REPO
if (repository === undefined) throw new Error('program driver requires DSH_TEST_PROGRAM_REPO')

// The roster's root has to be absolute and the smoke runs in an isolated
// temporary cwd, so the presets beside this file are exported by path.
process.env.DSH_TEST_PROGRAM_PRESETS = fileURLToPath(new URL('presets', import.meta.url))

// A host that configures git through `GIT_CONFIG_COUNT` hands every child a
// command-line config the shell seam cannot forward whole: `GIT_CONFIG_KEY_*`
// is credential-shaped, so the scrub drops the keys and keeps the count, and
// git then refuses every invocation. The fixture runs against its own
// repository, so it drops the whole set rather than inheriting half of it.
for (const name of Object.keys(process.env)) {
  if (name.startsWith('GIT_CONFIG_')) Reflect.deleteProperty(process.env, name)
}

/** Create the repository the program delivers into, once, with a tagged base commit. */
function ensureRepository(root: string): void {
  if (existsSync(join(root, '.git'))) return
  mkdirSync(root, { recursive: true })
  const git = (...args: string[]): void => void execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  git('init', '-q', '.')
  git('config', 'user.email', 'program@example.test')
  git('config', 'user.name', 'program fixture')
  writeFileSync(join(root, 'base.txt'), 'base\n')
  git('add', 'base.txt')
  git('commit', '-qm', 'base')
  git('tag', 'base')
}

/** The program the fixture runs: two goals, the second delivered after the first. */
function programSpec(label: string): ProgramSpec {
  const budget = { maxTotalTokens: 400_000, maxWallMs: 300_000 }
  return {
    objective: `deliver the ${label} release`,
    baseRevision: 'base',
    signoff: { principal: 'program-fixture', artefactSha256: 'f'.repeat(64) },
    goals: [
      {
        key: 'api',
        objective: 'Deliver the api of this program on its own branch.',
        preset: 'implementing',
        isolation: 'none',
        budget,
        dependsOn: [],
        checks: [{ id: 'api-base-present' as CheckId, outcome: 'the branch still carries the base file', run: 'test -f base.txt' }],
      },
      {
        key: 'docs',
        objective: 'Document the api of this program on its own branch.',
        preset: 'documenting',
        isolation: 'none',
        budget,
        dependsOn: ['api'],
        checks: [{ id: 'docs-base-present' as CheckId, outcome: 'the branch still carries the base file', run: 'test -f base.txt' }],
      },
    ],
    integration: {
      checks: [{ id: 'merged-base-present' as CheckId, outcome: 'the merged head carries the base file', run: 'test -f base.txt' }],
      gates: ['test -r base.txt'],
    },
  }
}

/** Every program ledger and every member stamp in the persistence root. */
async function readRoot(persistence: SessionPersistence): Promise<{ ledgers: LedgerLine[]; members: MemberLine[] }> {
  const ledgers: LedgerLine[] = []
  const members: MemberLine[] = []
  for (const stored of await persistence.list()) {
    const { events } = await persistence.inspect(stored.id)
    const programEvents = events.filter((event: SessionEvent) => event.type.startsWith('program/') && event.type !== 'program/member')
    if (programEvents.length > 0) {
      ledgers.push({ sessionId: stored.id, events: programEvents.map(event => ({ type: event.type, data: event.data })) })
    }
    for (const event of events) {
      if (event.type !== 'program/member') continue
      members.push({
        sessionId: stored.id,
        programId: event.data.programId,
        key: event.data.key,
        certified: events.some(candidate => candidate.type === 'verification/certificate'),
        caps: events.find(candidate => candidate.type === 'budget/caps')?.data,
      })
    }
  }
  return { ledgers, members }
}

// The repository has to exist before the program plugin validates its
// workspaceRoot, so it is minted before the composition loads.
ensureRepository(repository)

const ctx = await boot('program-e2e', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the program mounts presets and reads
  // persisted sessions, so the driver drives only the settled application.
  await ctx.get('loader')?.await()
  const programs = ctx.get('programs')
  const persistence = ctx.get('sessionPersistence')
  if (programs === undefined || persistence === undefined) throw new Error('program driver requires the programs and session persistence services')
  if (process.env.DSH_TEST_PROGRAM_KILL_AFTER_CERTIFIED === '1') {
    ctx.on('session/event', (_session, event) => {
      if (event.type === 'program/goal' && event.data.status === 'certified') process.exit(KILLED)
    })
  }
  const report = await programs.start(programSpec(process.env.DSH_TEST_PROGRAM_LABEL ?? 'first'))
  const observed = await readRoot(persistence)
  process.stdout.write(`${JSON.stringify({ type: 'result', report, ...observed })}\n`)
} finally {
  await ctx.fiber.dispose()
}
