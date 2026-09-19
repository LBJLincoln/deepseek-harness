/**
 * Run the code-safety program over one target tree and print what it released.
 *
 *   pnpm run code-safety -- <target path> [--out <dir>] [--model sonnet|opus] [--keyless]
 *
 * It seeds nothing itself: the fixture's driver mints the report repository,
 * locks the target, signs the spec and drives the six departments and their
 * integration. This wrapper resolves the paths, picks the composition, runs the
 * driver from source under tsx, and reads the one result line the driver wrote.
 *
 * The run directory defaults to `.code-safety/<target>-<timestamp>/`, which the
 * repository ignores. `--keyless` boots the scripted composition instead of the
 * Claude Code overlay, which needs no credential and reviews only the fixture's
 * own sample target.
 */

import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const FIXTURE_DIR = join(REPO_ROOT, 'examples/headless-agent/tests/fixtures/program-code-safety')
const DRIVER = join(FIXTURE_DIR, 'driver.ts')
const KEYLESS_COMPOSITION = join(FIXTURE_DIR, 'cordis.yml')
const CLAUDE_CODE_COMPOSITION = join(FIXTURE_DIR, 'overlays/claude-code.cordis.yml')
const SAMPLE_TARGET = join(FIXTURE_DIR, 'sample-target')
const KNOWLEDGE_ROOT = join(REPO_ROOT, 'data/knowledge/code-safety')
const RUNS_ROOT = join(REPO_ROOT, '.code-safety')

/** Models the Claude Code overlay declares; the run uses one for every session. */
const MODELS = ['sonnet', 'opus']

/** One goal of the program as the driver's result line states it. */
interface GoalLine {
  readonly key: string
  readonly status: string
  readonly revision?: string
}

/** The driver's one result line, as much of it as this wrapper reports. */
interface DriverResult {
  readonly report: {
    readonly programId: string
    readonly outcome?: string
    readonly goals: readonly GoalLine[]
  }
  readonly target: { readonly root: string; readonly files: number; readonly sha256: string }
  readonly elapsedSeconds: number
  readonly verifier: { readonly exitCode: number; readonly output: string }
  readonly findings: string
}

// `pnpm run code-safety -- …` forwards the separator itself, and `parseArgs`
// reads it as end-of-options, which would turn every flag into a positional.
const args = process.argv.slice(2)
if (args[0] === '--') args.shift()

const { values, positionals } = parseArgs({
  args,
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    model: { type: 'string' },
    keyless: { type: 'boolean' },
  },
})

const keyless = values.keyless === true
const target = positionals[0] === undefined
  ? (keyless ? SAMPLE_TARGET : undefined)
  : resolve(positionals[0])
if (target === undefined) {
  throw new Error('usage: pnpm run code-safety -- <target path> [--out <dir>] [--model sonnet|opus] [--keyless]')
}
if (!existsSync(target)) throw new Error(`code-safety: the target tree ${target} is not on this host`)
if (values.model !== undefined && !MODELS.includes(values.model)) {
  throw new Error(`code-safety: unknown model '${values.model}'; expected one of ${MODELS.join(' | ')}`)
}

const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-').slice(0, 19)
const outDir = values.out === undefined ? join(RUNS_ROOT, `${basename(target)}-${stamp}`) : resolve(values.out)
if (existsSync(join(outDir, 'stdout.jsonl'))) throw new Error(`code-safety: ${outDir} already holds a run`)
mkdirSync(outDir, { recursive: true })

const composition = keyless ? KEYLESS_COMPOSITION : CLAUDE_CODE_COMPOSITION
const reportRepository = join(outDir, 'repo')
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  DSH_CODE_SAFETY_REPORT_REPO: reportRepository,
  DSH_CODE_SAFETY_TARGET: target,
  DSH_TEST_SESSION_ROOT: join(outDir, '.sessions'),
  TSX_TSCONFIG_PATH: join(REPO_ROOT, 'tsconfig.json'),
  ...values.model === undefined ? {} : { DSH_CODE_SAFETY_MODEL: values.model },
  // The knowledge pack is optional: the overlay mounts a skill root only for a
  // directory this wrapper found.
  ...existsSync(KNOWLEDGE_ROOT) ? { DSH_CODE_SAFETY_SKILLS: KNOWLEDGE_ROOT } : {},
}

console.log(`code-safety: reviewing ${target}`)
console.log(`  composition ${composition.replace(`${REPO_ROOT}/`, '')}`)
console.log(`  model       ${keyless ? 'cli-mock (scripted)' : values.model ?? 'sonnet'}`)
console.log(`  knowledge   ${environment.DSH_CODE_SAFETY_SKILLS ?? 'none composed'}`)
console.log(`  run         ${outDir}`)

const stdoutPath = join(outDir, 'stdout.jsonl')
const stdout = createWriteStream(stdoutPath)
const stderr = createWriteStream(join(outDir, 'stderr.txt'))
const child = spawn(join(REPO_ROOT, 'node_modules/.bin/tsx'), [DRIVER, composition], { cwd: REPO_ROOT, env: environment })
child.stdout.pipe(stdout)
child.stderr.pipe(process.stderr, { end: false })
child.stderr.pipe(stderr)

const code = await new Promise<number>((settle) => {
  child.on('close', (exit) => {
    settle(exit ?? 1)
  })
})

if (code !== 0) {
  console.error(`code-safety: the driver exited ${String(code)}; its output is under ${outDir}`)
  process.exit(code)
}

const lines = readFileSync(stdoutPath, 'utf8').trimEnd().split('\n')
const result = JSON.parse(lines.at(-1) ?? '') as DriverResult
const integration = join(reportRepository, result.report.programId, '@integration')

console.log('')
console.log(`program ${result.report.programId}`)
console.log(`target  ${result.target.files} files, tree ${result.target.sha256}`)
console.log(`outcome ${result.report.outcome ?? 'unknown'} in ${String(result.elapsedSeconds)}s`)
console.log('')
for (const goal of result.report.goals) {
  console.log(`  ${goal.key.padEnd(14)} ${goal.status.padEnd(10)} ${goal.revision?.slice(0, 12) ?? ''}`)
}
console.log('')
console.log(`verifier exit ${String(result.verifier.exitCode)}: ${result.verifier.output.trim().split('\n').join('\n  ')}`)
if (result.findings !== '') console.log(`findings      ${String((JSON.parse(result.findings) as unknown[]).length)}`)
console.log(`report        ${join(integration, 'SAFETY-REPORT.md')}`)
console.log(`findings.json ${join(integration, 'findings.json')}`)

if (result.report.outcome !== 'released' || result.verifier.exitCode !== 0) process.exit(1)
