#!/usr/bin/env node
/**
 * Admission of the polyglot bench: for every exercise of the registered tracks
 * in a checkout, the fixture the registrar stages must fail its own test
 * command with the stubs it ships and pass it with the reference files
 * (`.meta/example.*`) copied over those stubs. Both runs happen in a sealed
 * cell with no network: `/` bound read-only, a private `/tmp`, the workspace
 * the only writable path, the environment scrubbed as the harness's shell
 * scrubs it. The cells a fleet runs are the same except that they keep the
 * network; admission removes it to show that no test needs one.
 *
 *   tsx admit.ts [--write] [--jobs <n>] [<checkout>]
 *
 * The checkout defaults to `POLYGLOT_BENCH_DIR` and must be unchanged under the
 * registered tracks. Prints one line per exercise and one count line per track.
 * Without `--write` it exits 1 when the admitted and refused ids differ from
 * `admission.json`; with `--write` it records the outcome there, with the
 * checkout's revision and the toolchain versions it ran under.
 */

import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  applyReference, checkoutChanges, checkoutRevision, listExercises, POLYGLOT_LANGUAGES, POLYGLOT_TEST_COMMANDS, polyglotId, readAdmission,
  readExercise, REFERENCE_DIRECTORY, stageExercise,
} from './polyglot.ts'
import type { PolyglotAdmission, PolyglotLanguage, PolyglotRefusal } from './polyglot.ts'

const ADMISSION_PATH = join(import.meta.dirname, 'admission.json')
const REPOSITORY = 'https://github.com/Aider-AI/polyglot-benchmark'
/** One test run may not outlast what a check is given before the executor stops it. */
const RUN_TIMEOUT_MS = 120_000
/** Output kept per run for the refusal reason. */
const OUTPUT_TAIL_CHARS = 16_384
/**
 * Names the harness's subprocess service withholds from every child it spawns,
 * a cell's commands included (`SENSITIVE_ENV_PATTERN` in
 * `@deepseek-ai/dsh-subprocess`); the exercises' code never receives them here either.
 */
const CREDENTIAL_NAMES = /KEY|PASSWORD|SECRET|TOKEN/iu

/** How one test command ended in a cell. */
interface CellRun {
  readonly status: number | null
  readonly timedOut: boolean
  readonly output: string
}

/** One exercise's admission outcome. */
type Outcome = { readonly id: string; readonly admitted: true } | { readonly id: string; readonly admitted: false; readonly reason: string }

/** The environment a cell's command sees: the parent's without credential-shaped and harness names, plus the shell's terminal overrides. */
function cellEnvironment(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !CREDENTIAL_NAMES.test(key) && !key.toUpperCase().startsWith('DSH_')) env[key] = value
  }
  return { ...env, NO_COLOR: '1', TERM: 'dumb', PAGER: 'cat', GIT_PAGER: 'cat' }
}

/** The bubblewrap argv of a sealed cell over one workspace, with the network removed. */
function cellArgv(workspace: string, command: string): string[] {
  return [
    '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--die-with-parent', '--tmpfs', '/tmp',
    '--bind', workspace, workspace, '--unshare-net', '--chdir', workspace, '--', 'bash', '-c', command,
  ]
}

/** Run one command in a sealed cell over `workspace`. */
function runInCell(workspace: string, command: string): Promise<CellRun> {
  return new Promise((resolveRun, reject) => {
    const child = spawn('bwrap', cellArgv(workspace, command), { env: cellEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let timedOut = false
    const keep = (chunk: Buffer): void => { output = `${output}${chunk.toString('utf8')}`.slice(-OUTPUT_TAIL_CHARS) }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, RUN_TIMEOUT_MS)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (status) => {
      clearTimeout(timer)
      resolveRun({ status, timedOut, output })
    })
  })
}

/**
 * What a run's output says happened, most telling first: a missing dependency,
 * then a compiler error, then a failed test, then an empty suite. Each group is
 * searched through the whole output before the next, since a build tool
 * reports where it failed before it reports why.
 */
const FINDINGS: readonly RegExp[] = [
  /could not find|no matching package|failed to (?:download|get|load)|unresolved import|no required module/iu,
  /\berror\b/iu,
  /\bfail(?:ed|ure)?\b|panicked|assertion/iu,
  /no tests? to run|no tests ran/iu,
]

/** The line of a run's output that says what happened, whitespace collapsed and bounded. */
function finding(output: string): string {
  const lines = output.split('\n').map(line => line.replace(/\s+/gu, ' ').trim()).filter(line => line !== '')
  const line = FINDINGS.map(pattern => lines.find(candidate => pattern.test(candidate))).find(match => match !== undefined) ?? lines.at(-1) ?? 'no output'
  return line.length > 240 ? `${line.slice(0, 240)}...` : line
}

/** Admit or refuse one exercise, in a scratch directory removed afterwards. */
async function admit(checkout: string, language: PolyglotLanguage, name: string): Promise<Outcome> {
  const id = polyglotId(language, name)
  const root = mkdtempSync(join(tmpdir(), 'polyglot-admit-'))
  try {
    const exercise = readExercise(checkout, language, name)
    const fixture = join(root, 'fixture')
    const workspace = join(root, 'workspace')
    stageExercise(exercise, fixture)
    cpSync(fixture, workspace, { recursive: true })
    rmSync(join(workspace, REFERENCE_DIRECTORY), { recursive: true, force: true })
    const command = POLYGLOT_TEST_COMMANDS[language]
    const stub = await runInCell(workspace, command)
    if (stub.timedOut) return { id, admitted: false, reason: `the stub's test run ran past ${RUN_TIMEOUT_MS / 1000} s` }
    if (stub.status === 0) return { id, admitted: false, reason: `the stub passes its own tests: ${finding(stub.output)}` }
    applyReference(exercise, fixture, workspace)
    const reference = await runInCell(workspace, command)
    if (reference.timedOut) return { id, admitted: false, reason: `the reference's test run ran past ${RUN_TIMEOUT_MS / 1000} s` }
    if (reference.status !== 0) return { id, admitted: false, reason: `the reference fails its tests: ${finding(reference.output)}` }
    return { id, admitted: true }
  } catch (error) {
    return { id, admitted: false, reason: error instanceof Error ? error.message : String(error) }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** The first line a version command prints, or why it printed none. */
function version(command: string, args: readonly string[]): string {
  const run = spawnSync(command, args, { encoding: 'utf8' })
  const line = `${run.stdout}${run.stderr}`.split('\n').find(candidate => candidate.trim() !== '')
  if (run.status !== 0 || line === undefined) throw new Error(`admit: \`${command} ${args.join(' ')}\` did not report a version`)
  return line.trim()
}

/** The toolchain versions each track's command runs under on this host. */
function toolchains(): Record<PolyglotLanguage, string> {
  return {
    cpp: `${version('cmake', ['--version'])}; ${version('c++', ['--version'])}`,
    go: version('go', ['version']),
    python: `${version('python3', ['--version'])}; ${version('python3', ['-m', 'pytest', '--version'])}`,
    rust: `${version('cargo', ['--version'])}; ${version('rustc', ['--version'])}`,
  }
}

/** Run `work` over `items` with at most `jobs` in flight, keeping input order. */
async function pool<T, R>(items: readonly T[], jobs: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await work(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, worker))
  return results
}

/** The ids on one side and not the other, for the check-mode report. */
function difference(left: readonly string[], right: readonly string[]): string[] {
  return left.filter(id => !right.includes(id))
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { write: { type: 'boolean', default: false }, jobs: { type: 'string', default: '4' } },
})
const jobs = Number(values.jobs)
if (!Number.isSafeInteger(jobs) || jobs < 1) throw new Error(`admit: --jobs must be a positive integer, got ${JSON.stringify(values.jobs)}`)
const checkoutArg = positionals[0] ?? process.env.POLYGLOT_BENCH_DIR
if (checkoutArg === undefined || checkoutArg === '') throw new Error('admit: name the checkout as an argument or in POLYGLOT_BENCH_DIR')
const checkout = resolve(checkoutArg)
if (spawnSync('bwrap', cellArgv(tmpdir(), 'true')).status !== 0) throw new Error('admit: bwrap cannot start a sealed cell without network on this host')
const changes = checkoutChanges(checkout)
if (changes.length > 0) throw new Error(`admit: ${checkout} differs from its commit under ${POLYGLOT_LANGUAGES.join(', ')}: ${changes.slice(0, 5).join('; ')}`)
const revision = checkoutRevision(checkout)
const exercises = POLYGLOT_LANGUAGES.flatMap(language => listExercises(checkout, language).map(name => ({ language, name })))
const outcomes = await pool(exercises, jobs, async ({ language, name }) => {
  const outcome = await admit(checkout, language, name)
  process.stdout.write(outcome.admitted ? `admit ${outcome.id}\n` : `REFUSE ${outcome.id}: ${outcome.reason}\n`)
  return outcome
})
const admitted = outcomes.filter(outcome => outcome.admitted).map(outcome => outcome.id).sort()
const refused: PolyglotRefusal[] = outcomes
  .flatMap(outcome => (outcome.admitted ? [] : [{ id: outcome.id, reason: outcome.reason }]))
  .sort((left, right) => (left.id < right.id ? -1 : 1))
for (const language of POLYGLOT_LANGUAGES) {
  const prefix = `polyglot:${language}:`
  const count = (ids: readonly string[]): number => ids.filter(id => id.startsWith(prefix)).length
  process.stdout.write(`${language}: ${count(admitted)} admitted, ${count(refused.map(entry => entry.id))} refused\n`)
}
if (values.write) {
  const record: PolyglotAdmission = { repository: REPOSITORY, revision, toolchains: toolchains(), admitted, refused }
  writeFileSync(ADMISSION_PATH, `${JSON.stringify(record, null, 2)}\n`)
  process.stdout.write(`admit: recorded ${admitted.length} admitted and ${refused.length} refused at ${revision} in ${ADMISSION_PATH}\n`)
} else {
  if (!existsSync(ADMISSION_PATH)) throw new Error(`admit: ${ADMISSION_PATH} does not exist; run with --write to record one`)
  const recorded = readAdmission(ADMISSION_PATH)
  const recordedRefused = recorded.refused.map(entry => entry.id)
  const drift = [
    ...recorded.revision === revision ? [] : [`revision ${revision} against the recorded ${recorded.revision}`],
    ...difference(admitted, recorded.admitted).map(id => `${id} admitted here, not in the record`),
    ...difference(recorded.admitted, admitted).map(id => `${id} admitted in the record, not here`),
    ...difference(refused.map(entry => entry.id), recordedRefused).map(id => `${id} refused here, not in the record`),
  ]
  if (drift.length > 0) {
    process.stderr.write(`admit: the outcome differs from ${ADMISSION_PATH}:\n${drift.map(line => `  ${line}`).join('\n')}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(`admit: the outcome matches ${ADMISSION_PATH}\n`)
  }
}
