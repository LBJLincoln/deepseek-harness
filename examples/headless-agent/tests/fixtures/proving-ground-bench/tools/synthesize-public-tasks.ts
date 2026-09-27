#!/usr/bin/env node
/**
 * Environment factory: derives function-implementation tasks with hidden
 * tests from permissively licensed public JavaScript and TypeScript
 * repositories, generalizing `synthesize-repository-tasks.ts` from this
 * repository's own packages to any repository `public-sources.json` names.
 *
 * For every source in the allowlist the factory fetches the pinned commit into
 * a gitignored cache (`git fetch --depth 1` of that commit alone), refuses the
 * source unless its licence file has the recorded SHA-256, reads as the
 * declared SPDX id, and that id is one whose terms admit a derived task as
 * training material with attribution kept (MIT, ISC, BSD-2-Clause,
 * BSD-3-Clause, Apache-2.0), and then reads the listed directories. Every test
 * file that imports only modules under the source root and a supported runner
 * (`vitest`, `@jest/globals`, or their globals with the matcher subset
 * `expect-shim.mjs` implements; `node:test` with `node:assert`) yields one
 * hidden case per block, and every exported function with a JSDoc block of a
 * module such a test imports yields a child under
 * `environments-public/<source>--<function>/`: the module's dependency closure
 * transpiled to plain ESM JavaScript under `src/` with that one function's body
 * replaced by `throw new Error('not implemented')`, the shim under
 * `test/expect-shim.mjs` for an `expect` suite, the source's licence text as
 * `LICENSE`, a `README.md` that is task content (the prompt, the attribution,
 * and the type declarations the build erased), `package.json`, the untouched
 * closure under `reference/src/`, and under `reference/cases.json` the cases
 * that exercise the function. The prompt names the file, the function, the
 * source and its licence, and hands over the JSDoc and the signature; it never
 * reveals the tests.
 *
 * The factory runs every case against the reference first and drops the cases
 * the reference fails, which are the shim or the transform falling short of
 * that block; then per function it runs the remaining cases against the stub
 * and keeps the ones that fail, which are the cases that reach the function. A
 * function no case reaches yields no child. A child's tier is set by that
 * count (`--tier-bands`); a child keeps at most `--max-cases` of them, spread
 * evenly over the exercising cases in pooled order, because a module many
 * tests import (a library's `pipe`) is reached by hundreds of blocks and a
 * validator runs one process per case. Every child is `heldOut: false`, and
 * every child's `task.json` carries the source's URL, commit, licence id,
 * licence digest, and copyright line, and the data-use terms the licence
 * admits.
 *
 * Deterministic: sources, files, and functions are processed in file or
 * sorted order, so two runs over the same allowlist produce identical output.
 * Idempotent: `--out-dir` is removed and rewritten whole on every real run.
 *
 *   node synthesize-public-tasks.ts [options]
 *
 * Options:
 *   --sources <path>         the allowlist (default: ./public-sources.json)
 *   --cache-dir <path>       where sources are fetched (default: <repository>/.proving-ground/public-sources, gitignored)
 *   --out-dir <path>         where children are written (default: ../environments-public)
 *   --only <a,b>             read only the named sources; the census still lists every source
 *   --min-lines <n>          skip a function whose body has fewer lines (default: 1)
 *   --tier-bands <a,b>       tier 3 from a exercising cases, tier 4 from b (default: 4,12)
 *   --max-cases <n>          keep at most n exercising cases per child, spread evenly over them; the tier is set before the
 *                            cap (default: 60)
 *   --max-per-source <n>     write at most n children per source, in module order; 0 for no cap (default: 0)
 *   --case-timeout-ms <n>    how long one case program may run (default: 20000)
 *   --concurrency <n>        case programs run at once (default: the host's parallelism)
 *   --dry-run                fetch, analyze, and print the census of tests and candidates; run no case and write nothing
 *   --admit                  after writing, run admit.mjs over --out-dir, delete every child it rejects, and record why in
 *                            REFUSED.json; CENSUS.json is written either way
 */

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { availableParallelism, tmpdir } from 'node:os'
import { dirname, join, posix, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  analyzeTest,
  CASES_FILE,
  classifyLicense,
  copyrightLine,
  exportMap,
  isModuleFile,
  isTestFile,
  LICENSE_FILE,
  parseSourceManifest,
  publicReadme,
  publicTaskJson,
  rejectionCategory,
  resolveRelative,
  rewriteSpecifiers,
  runtimeImports,
  SHIM_FILE,
  termsFor,
  workspacePath,
} from './public-environments.ts'
import type { DataUseTerms, ExportMap, PublicCensus, PublicSource, SourceCensus, TestCase, TestContext, TestPlan } from './public-environments.ts'
import { analyzeModule, caseEntries, childId, parseTierBands, stubFunction, transpile } from './repository-environments.ts'
import type { TierBands } from './repository-environments.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const BENCH_ROOT = join(HERE, '..')
const REPO_ROOT = resolve(BENCH_ROOT, '..', '..', '..', '..', '..')
const SHIM = readFileSync(join(HERE, 'expect-shim.mjs'), 'utf8')
const CENSUS_FILE = 'CENSUS.json'
const REFUSED_FILE = 'REFUSED.json'
const IGNORED_DIRECTORIES: ReadonlySet<string> = new Set(['node_modules', '__snapshots__', '.git', 'dist', 'coverage'])

/** The factory's options, every one settable from the command line. */
interface Options {
  readonly sourcesPath: string
  readonly cacheDir: string
  readonly outDir: string
  readonly only: readonly string[] | undefined
  readonly minLines: number
  readonly bands: TierBands
  readonly maxCases: number
  readonly maxPerSource: number
  readonly caseTimeoutMs: number
  readonly concurrency: number
  readonly dryRun: boolean
  readonly admit: boolean
}

const DEFAULTS: Options = {
  sourcesPath: join(HERE, 'public-sources.json'),
  cacheDir: join(REPO_ROOT, '.proving-ground', 'public-sources'),
  outDir: join(BENCH_ROOT, 'environments-public'),
  only: undefined,
  minLines: 1,
  bands: { tier3From: 4, tier4From: 12 },
  maxCases: 60,
  maxPerSource: 0,
  caseTimeoutMs: 20_000,
  concurrency: availableParallelism(),
  dryRun: false,
  admit: false,
}

function requireValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index]
  if (value === undefined) throw new Error(`synthesize-public-tasks: ${flag} needs a value`)
  return value
}

function requireInt(argv: readonly string[], index: number, flag: string, minimum: number): number {
  const value = Number(requireValue(argv, index, flag))
  if (!Number.isInteger(value) || value < minimum) throw new Error(`synthesize-public-tasks: ${flag} needs an integer of at least ${minimum}`)
  return value
}

/**
 * The command line, parsed over the defaults the header documents.
 * @param argv - `process.argv.slice(2)`.
 * @param defaults - the options every flag overrides.
 * @returns the options.
 * @throws on an unknown flag, a missing or malformed value, or `--dry-run` with `--admit`.
 */
export function parseArgs(argv: readonly string[], defaults: Options): Options {
  let options = defaults
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string
    switch (arg) {
      case '--dry-run':
        options = { ...options, dryRun: true }
        break
      case '--admit':
        options = { ...options, admit: true }
        break
      case '--sources':
        options = { ...options, sourcesPath: resolve(requireValue(argv, ++index, arg)) }
        break
      case '--cache-dir':
        options = { ...options, cacheDir: resolve(requireValue(argv, ++index, arg)) }
        break
      case '--out-dir':
        options = { ...options, outDir: resolve(requireValue(argv, ++index, arg)) }
        break
      case '--only':
        options = { ...options, only: requireValue(argv, ++index, arg).split(',').filter(name => name !== '') }
        break
      case '--min-lines':
        options = { ...options, minLines: requireInt(argv, ++index, arg, 0) }
        break
      case '--tier-bands':
        options = { ...options, bands: parseTierBands(requireValue(argv, ++index, arg)) }
        break
      case '--max-cases':
        options = { ...options, maxCases: requireInt(argv, ++index, arg, 1) }
        break
      case '--max-per-source':
        options = { ...options, maxPerSource: requireInt(argv, ++index, arg, 0) }
        break
      case '--case-timeout-ms':
        options = { ...options, caseTimeoutMs: requireInt(argv, ++index, arg, 1) }
        break
      case '--concurrency':
        options = { ...options, concurrency: requireInt(argv, ++index, arg, 1) }
        break
      default:
        throw new Error(`synthesize-public-tasks: unrecognised argument "${arg}"`)
    }
  }
  if (options.dryRun && options.admit) throw new Error('synthesize-public-tasks: --dry-run and --admit are mutually exclusive')
  return options
}

// --- Fetching ------------------------------------------------------------------------

/** Runs one git command in `cwd`; the failure line on a non-zero exit: git's own `fatal:` or `error:` line, else the last line. */
function git(cwd: string, args: readonly string[]): string | undefined {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 600_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  if (result.error !== undefined) return result.error.message
  if (result.status === 0) return undefined
  const lines = `${result.stderr}\n${result.stdout}`.split('\n').map(line => line.trim()).filter(line => line !== '')
  return lines.find(line => /^(?:fatal|error):/u.test(line)) ?? lines.at(-1) ?? `git exited ${String(result.status)}`
}

/**
 * The source's checkout at its pinned commit under the cache: reused when the
 * cache already holds that commit, fetched fresh otherwise, one commit deep.
 * @returns the checkout directory, or the failure message.
 */
function fetchSource(source: PublicSource, cacheDir: string): { dir: string } | { failure: string } {
  const dir = join(cacheDir, source.name)
  if (existsSync(join(dir, '.git'))) {
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' })
    if (head.status === 0 && head.stdout.trim() === source.commit) return { dir }
    rmSync(dir, { recursive: true, force: true })
  }
  mkdirSync(dir, { recursive: true })
  const steps: readonly { readonly label: string; readonly args: readonly string[] }[] = [
    { label: 'git init', args: ['init', '-q'] },
    { label: 'git remote add', args: ['remote', 'add', 'origin', source.url] },
    { label: 'git fetch', args: ['fetch', '-q', '--depth', '1', 'origin', source.commit] },
    { label: 'git checkout', args: ['-c', 'advice.detachedHead=false', 'checkout', '-q', 'FETCH_HEAD'] },
  ]
  for (const step of steps) {
    const failure = git(dir, step.args)
    if (failure !== undefined) {
      rmSync(dir, { recursive: true, force: true })
      return { failure: `${step.label} failed: ${failure}` }
    }
  }
  return { dir }
}

/** A source's licence as the factory read it: the text every child carries and the terms it admits. */
interface SourceLicense {
  readonly text: string
  readonly terms: DataUseTerms
}

/** The licence text of a fetched source, or why the source is refused. */
function readLicense(source: PublicSource, dir: string): SourceLicense | { failure: string } {
  const path = join(dir, source.licenseFile)
  if (!existsSync(path)) return { failure: `licence file ${source.licenseFile} is missing` }
  const text = readFileSync(path, 'utf8')
  const digest = createHash('sha256').update(text, 'utf8').digest('hex')
  if (digest !== source.licenseSha256) return { failure: `licence file ${source.licenseFile} digests to ${digest}, not the recorded ${source.licenseSha256}` }
  const classified = classifyLicense(text)
  if (classified !== source.license) return { failure: `licence text reads as ${classified ?? 'no recognized licence'}, declared ${source.license}` }
  const terms = termsFor(source.license)
  if (terms === undefined) return { failure: `licence ${source.license} admits no derived task` }
  return { text, terms }
}

// --- The source tree ---------------------------------------------------------------------

/** One fetched source with the caches its analysis needs, in the context form the pure analysis reads. */
class SourceTree implements TestContext {
  readonly source: PublicSource
  readonly dir: string
  readonly rootDir: string
  private readonly js = new Map<string, string>()
  private readonly exports = new Map<string, ExportMap | undefined>()
  private readonly fileness = new Map<string, boolean>()

  constructor(source: PublicSource, dir: string) {
    this.source = source
    this.dir = dir
    this.rootDir = resolve(dir, source.root)
  }

  /** The source-relative POSIX path the census and the provenance name a file by. */
  relative(file: string): string {
    return relative(this.dir, file).split('\\').join('/')
  }

  isFile(path: string): boolean {
    let known = this.fileness.get(path)
    if (known === undefined) {
      known = existsSync(path) && statSync(path).isFile()
      this.fileness.set(path, known)
    }
    return known
  }

  /** The JavaScript build of one file, transpiled once. */
  jsOf(file: string): string {
    let built = this.js.get(file)
    if (built === undefined) {
      built = transpile(readFileSync(file, 'utf8'), file)
      this.js.set(file, built)
    }
    return built
  }

  readonly exportMapOf = (file: string): ExportMap | undefined => {
    if (!this.exports.has(file)) {
      this.exports.set(file, this.isFile(file) && isModuleFile(file) ? exportMap(this.jsOf(file), file) : undefined)
    }
    return this.exports.get(file)
  }

  readonly resolve = (fromFile: string, specifier: string): string | undefined =>
    resolveRelative(fromFile, specifier, path => this.isFile(path))

  readonly workspacePath = (file: string): string | undefined => workspacePath(this.rootDir, file)

  readonly isTest = (file: string): boolean => isTestFile(file)
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) yield* walk(join(dir, entry.name))
    } else if (entry.isFile()) {
      yield join(dir, entry.name)
    }
  }
}

/** Every module and test file under the source's listed directories, each once, sorted. */
function discoverFiles(tree: SourceTree): { modules: string[]; tests: string[] } {
  const modules = new Set<string>()
  const tests = new Set<string>()
  for (const directory of tree.source.directories) {
    const dir = resolve(tree.dir, directory)
    if (!existsSync(dir)) continue
    for (const file of walk(dir)) {
      if (isTestFile(file)) {
        if (!/\.test-d\.[cm]?tsx?$/u.test(file)) tests.add(file)
      } else if (isModuleFile(file)) {
        modules.add(file)
      }
    }
  }
  return { modules: [...modules].sort(), tests: [...tests].sort() }
}

/** One source file as a child workspace holds it: its workspace path and its JavaScript with imports re-pointed. */
interface ClosureFile {
  readonly path: string
  readonly js: string
}

/** The transitive relative-import closure of `entries` as workspace files, or why it cannot be built. */
function closureOf(tree: SourceTree, entries: readonly string[]): { files: Map<string, ClosureFile> } | { problem: string } {
  const files = new Map<string, ClosureFile>()
  const queue = [...entries]
  const seen = new Set<string>()
  while (queue.length > 0) {
    const file = queue.shift() as string
    if (seen.has(file)) continue
    seen.add(file)
    const path = tree.workspacePath(file)
    if (path === undefined) return { problem: `${tree.relative(file)} lies outside the source root` }
    const js = tree.jsOf(file)
    const imports = runtimeImports(js, file)
    if (imports.dynamic) return { problem: `${tree.relative(file)} imports dynamically` }
    const targets = new Map<string, string>()
    for (const specifier of imports.specifiers) {
      if (isBuiltin(specifier)) continue
      if (!specifier.startsWith('.')) return { problem: `${tree.relative(file)} imports the package ${specifier}` }
      const target = tree.resolve(file, specifier)
      if (target === undefined) return { problem: `${tree.relative(file)} imports ${specifier}, which does not resolve` }
      const targetPath = tree.workspacePath(target)
      if (targetPath === undefined) return { problem: `${tree.relative(target)} lies outside the source root` }
      targets.set(specifier, targetPath)
      queue.push(target)
    }
    const rewritten = rewriteSpecifiers(js, file, (specifier) => {
      const targetPath = targets.get(specifier)
      if (targetPath === undefined) return undefined
      const relativePath = posix.relative(posix.dirname(path), targetPath)
      return relativePath.startsWith('.') ? relativePath : `./${relativePath}`
    })
    files.set(file, { path, js: rewritten })
  }
  return { files }
}

// --- Case execution ---------------------------------------------------------------------

/** The one failure line a case program leaves on stderr: the thrown error's own line, or the last line. */
function failureLine(stderr: string): string {
  const lines = stderr.split('\n').map(line => line.trim()).filter(line => line !== '')
  return lines.find(line => /^\w*Error: /u.test(line)) ?? lines.at(-1) ?? 'exited non-zero'
}

/** Runs one case program in `cwd`; `undefined` on exit 0, otherwise the failure line. */
function runCase(cwd: string, program: string, timeoutMs: number): Promise<string | undefined> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, ['--input-type=module'], { cwd, stdio: ['pipe', 'ignore', 'pipe'] })
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 65_536) stderr += chunk
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolvePromise(error.message)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) resolvePromise(`timed out after ${timeoutMs} ms`)
      else if (code === 0) resolvePromise(undefined)
      else resolvePromise(failureLine(stderr))
    })
    child.stdin.on('error', () => {
      // A program that exits before reading its input closes the pipe; the exit code already carries the verdict.
    })
    child.stdin.end(program)
  })
}

/** One case a program failed, with the failure line it left. */
interface FailedCase {
  readonly one: TestCase
  readonly failure: string
}

/** The cases the program in `cwd` fails, in case order, run `concurrency` at a time. */
async function failingCases(cwd: string, cases: readonly TestCase[], options: Options): Promise<FailedCase[]> {
  const failures: (FailedCase | undefined)[] = new Array<FailedCase | undefined>(cases.length).fill(undefined)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < cases.length) {
      const index = next
      next += 1
      const one = cases[index] as TestCase
      const failure = await runCase(cwd, one.program, options.caseTimeoutMs)
      if (failure !== undefined) failures[index] = { one, failure }
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency, cases.length) }, () => worker()))
  return failures.filter((failed): failed is FailedCase => failed !== undefined)
}

/**
 * At most `limit` of `cases`, spread evenly over them in order: the first and
 * every `length / limit`-th after it, so the kept cases come from every test
 * that reaches the function rather than the first few files.
 */
function sampleCases(cases: readonly TestCase[], limit: number): TestCase[] {
  if (cases.length <= limit) return [...cases]
  const kept: TestCase[] = []
  for (let index = 0; index < limit; index += 1) kept.push(cases[Math.floor((index * cases.length) / limit)] as TestCase)
  return kept
}

/** `undefined` when `filePath` parses as JavaScript, the first line of `node --check`'s complaint otherwise. */
function syntaxError(filePath: string): string | undefined {
  const result = spawnSync(process.execPath, ['--check', filePath], { encoding: 'utf8' })
  if (result.status === 0) return undefined
  return (result.stderr || result.stdout || 'node --check failed').trim().split('\n')[0]
}

// --- Writing ---------------------------------------------------------------------------

/** Writes the closure under `root`, one file per workspace path, with `override` replacing one file's text. */
function writeClosure(root: string, files: ReadonlyMap<string, ClosureFile>, override?: { file: string; js: string }): void {
  for (const [file, { path, js }] of files) {
    const target = join(root, ...path.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, override !== undefined && override.file === file ? override.js : js)
  }
}

function writeShim(root: string): void {
  const target = join(root, ...SHIM_FILE.split('/'))
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, SHIM)
}

/** One written child, as the census and admission track it. */
interface WrittenChild {
  readonly directory: string
  readonly id: string
  readonly tier: number
  readonly source: string
}

// --- Admission ------------------------------------------------------------------------------

interface Refusal {
  readonly name: string
  readonly reason: string
}

function parseAdmission(stdout: string, stderr: string): { admitted: string[]; refused: Refusal[] } {
  const admitted: string[] = []
  for (const line of stdout.split('\n')) {
    const match = /^admit (\S+) /u.exec(line)
    if (match?.[1] !== undefined) admitted.push(match[1])
  }
  const refused: Refusal[] = []
  for (const line of stderr.split('\n')) {
    const match = /^REJECT (\S+): (.+)$/u.exec(line)
    if (match?.[1] !== undefined && match[2] !== undefined) refused.push({ name: match[1], reason: match[2] })
  }
  return { admitted, refused }
}

/** The reported reason's category, coarse enough to summarize but still naming what admission actually found. */
function reasonCategory(reason: string): string {
  const [first = reason] = reason.split('; ')
  if (first.includes('the reference misses')) return 'reference misses a case'
  if (first.includes('the pre-state passes every case')) return 'pre-state passes every case'
  if (first.startsWith('task.json lacks')) return 'task.json missing a required field'
  if (first.startsWith('no reference/src')) return 'no reference/src'
  if (first.startsWith('node_modules present')) return 'node_modules present'
  if (first.includes('does not match directory')) return 'id does not match directory'
  return first
}

/** Runs `admit.mjs` over the output, deletes every child it rejects, and writes `REFUSED.json`. */
function admitAndPrune(options: Options): { admitted: Set<string>; refused: Refusal[] } {
  const result = spawnSync(process.execPath, [join(BENCH_ROOT, 'admit.mjs'), options.outDir], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const { admitted, refused } = parseAdmission(result.stdout, result.stderr)
  for (const { name } of refused) rmSync(join(options.outDir, name), { recursive: true, force: true })
  refused.sort((left, right) => left.name.localeCompare(right.name))
  writeFileSync(
    join(options.outDir, REFUSED_FILE),
    `${JSON.stringify(refused.map(one => ({ ...one, category: reasonCategory(one.reason) })), null, 2)}\n`,
  )
  return { admitted: new Set(admitted), refused }
}

// --- Reporting ------------------------------------------------------------------------------

function tally(values: readonly (string | number)[]): Record<string, number> {
  const counts = new Map<string | number, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return Object.fromEntries([...counts.entries()].sort((left, right) => (String(left[0]) > String(right[0]) ? 1 : -1)))
}

function sortedRecord(record: Readonly<Record<string, number>>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)))
}

function merge(into: Record<string, number>, from: Readonly<Record<string, number>>): void {
  for (const [key, count] of Object.entries(from)) into[key] = (into[key] ?? 0) + count
}

/** The mutable census of one source while it is read. */
interface SourceTally {
  readonly source: PublicSource
  status: 'read' | 'dropped'
  reason: string | undefined
  modules: number
  tests: number
  testsUsable: number
  readonly testsRejected: Record<string, number>
  readonly blocksDropped: Record<string, number>
  readonly blocksSkipped: Record<string, number>
  candidates: number
  written: number
  admitted: number
}

function sourceCensus(one: SourceTally): SourceCensus {
  return {
    name: one.source.name,
    url: one.source.url,
    commit: one.source.commit,
    license: one.source.license,
    status: one.status,
    ...one.reason === undefined ? {} : { reason: one.reason },
    modules: one.modules,
    tests: one.tests,
    testsUsable: one.testsUsable,
    testsRejected: sortedRecord(one.testsRejected),
    blocksDropped: sortedRecord(one.blocksDropped),
    blocksSkipped: sortedRecord(one.blocksSkipped),
    candidates: one.candidates,
    written: one.written,
    admitted: one.admitted,
  }
}

// --- The run ---------------------------------------------------------------------------------

/** A test that judges one module: the test's plan, of which the module is a target. */
interface JudgingTest {
  readonly test: string
  readonly plan: TestPlan
}

/** The run-wide counts the census reports beside the per-source ones. */
interface RunTally {
  readonly skips: Record<string, number>
  casesDroppedByReference: number
  candidates: number
}

function skip(run: RunTally, reason: string, subject: string): void {
  run.skips[reason] = (run.skips[reason] ?? 0) + 1
  console.error(`skip ${subject}: ${reason}`)
}

/** Derives every child of one source: the tests' plans, then per judged module the reference run and one stub run per function. */
async function deriveSource(
  tree: SourceTree,
  license: SourceLicense,
  tally: SourceTally,
  run: RunTally,
  options: Options,
  written: WrittenChild[],
): Promise<void> {
  const { modules, tests } = discoverFiles(tree)
  tally.modules = modules.length
  tally.tests = tests.length
  const judging = new Map<string, JudgingTest[]>()
  for (const test of tests) {
    const analysis = analyzeTest(tree.jsOf(test), test, tree)
    if (analysis.kind === 'rejected') {
      tally.testsRejected[rejectionCategory(analysis.reason)] = (tally.testsRejected[rejectionCategory(analysis.reason)] ?? 0) + 1
      console.error(`reject ${tree.source.name}/${tree.relative(test)}: ${analysis.reason}`)
      continue
    }
    tally.testsUsable += 1
    merge(tally.blocksDropped, analysis.plan.dropped)
    merge(tally.blocksSkipped, analysis.plan.skipped)
    for (const target of analysis.plan.targets) {
      const list = judging.get(target) ?? []
      list.push({ test, plan: analysis.plan })
      judging.set(target, list)
    }
  }
  if (options.dryRun) {
    for (const [module, judges] of [...judging.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const analysis = analyzeModule(readFileSync(module, 'utf8'), module)
      const candidates = analysis.functions.filter(fn => fn.jsDoc !== '' && fn.bodyLines >= options.minLines)
      tally.candidates += candidates.length
      run.candidates += candidates.length
      const cases = judges.reduce((sum, judge) => sum + judge.plan.cases.length, 0)
      for (const fn of candidates) console.log(`would consider ${childId(tree.source.name, fn.name)} (${tree.relative(module)}, ${judges.length} test(s), ${cases} cases)`)
    }
    return
  }
  const taken = new Set<string>()
  for (const [module, judges] of [...judging.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const subject = `${tree.source.name}/${tree.relative(module)}`
    const analysis = analyzeModule(readFileSync(module, 'utf8'), module)
    const candidates = analysis.functions.filter(fn => fn.jsDoc !== '' && fn.bodyLines >= options.minLines)
    run.skips['no JSDoc'] = (run.skips['no JSDoc'] ?? 0) + analysis.functions.filter(fn => fn.jsDoc === '').length
    run.skips['too short'] = (run.skips['too short'] ?? 0) + analysis.functions.filter(fn => fn.jsDoc !== '' && fn.bodyLines < options.minLines).length
    if (candidates.length === 0) continue
    const entries = [module, ...judges.flatMap(judge => judge.plan.entries)]
    const closure = closureOf(tree, entries)
    if ('problem' in closure) {
      for (const fn of candidates) skip(run, 'module closure unusable', `${childId(tree.source.name, fn.name)} (${closure.problem})`)
      continue
    }
    const shim = judges.some(judge => judge.plan.framework === 'expect')
    const pooled: TestCase[] = []
    for (const judge of judges) {
      for (const one of judge.plan.cases) pooled.push({ ordinal: pooled.length + 1, title: `${tree.relative(judge.test)} › ${one.title}`, program: one.program })
    }
    const scratch = mkdtempSync(join(tmpdir(), 'public-reference-'))
    let passing: TestCase[]
    try {
      writeClosure(scratch, closure.files)
      if (shim) writeShim(scratch)
      const failed = await failingCases(scratch, pooled, options)
      const failedOrdinals = new Set(failed.map(one => one.one.ordinal))
      for (const one of failed) console.error(`drop case ${subject} "${one.one.title}": the reference fails it: ${one.failure}`)
      run.casesDroppedByReference += failed.length
      passing = pooled.filter(one => !failedOrdinals.has(one.ordinal))
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
    if (passing.length === 0) {
      for (const fn of candidates) skip(run, 'reference passes no case of the module', childId(tree.source.name, fn.name))
      continue
    }
    const modulePath = closure.files.get(module) as { path: string; js: string }
    const provenanceBase = {
      source: tree.source.name,
      url: tree.source.url,
      commit: tree.source.commit,
      license: tree.source.license,
      licenseFile: tree.source.licenseFile,
      licenseSha256: tree.source.licenseSha256,
      ...(() => {
        const copyright = copyrightLine(license.text)
        return copyright === undefined ? {} : { copyright }
      })(),
      module: tree.relative(module),
      tests: judges.map(judge => tree.relative(judge.test)),
    }
    for (const fn of candidates) {
      tally.candidates += 1
      run.candidates += 1
      const directory = childId(tree.source.name, fn.name)
      if (taken.has(directory)) {
        skip(run, 'function name already taken in the source', directory)
        continue
      }
      if (options.maxPerSource > 0 && tally.written >= options.maxPerSource) {
        skip(run, 'source cap reached', directory)
        continue
      }
      const childDir = join(options.outDir, directory)
      rmSync(childDir, { recursive: true, force: true })
      writeClosure(childDir, closure.files, { file: module, js: stubFunction(modulePath.js, fn.name, modulePath.path) })
      if (shim) writeShim(childDir)
      writeFileSync(join(childDir, LICENSE_FILE), license.text)
      writeFileSync(join(childDir, 'package.json'), `${JSON.stringify({ name: tree.source.name, type: 'module', private: true }, null, 2)}\n`)
      const stubProblem = syntaxError(join(childDir, ...modulePath.path.split('/')))
      if (stubProblem !== undefined) {
        rmSync(childDir, { recursive: true, force: true })
        skip(run, 'stub does not parse', `${directory} (${stubProblem})`)
        continue
      }
      const exercising = (await failingCases(childDir, passing, options)).map(failed => failed.one)
      if (exercising.length === 0) {
        rmSync(childDir, { recursive: true, force: true })
        skip(run, 'no case exercises it', directory)
        continue
      }
      taken.add(directory)
      writeClosure(join(childDir, 'reference'), closure.files)
      const task = publicTaskJson({
        provenance: provenanceBase,
        terms: license.terms,
        functionName: fn.name,
        file: modulePath.path,
        jsDoc: fn.jsDoc,
        signature: fn.signature,
        companions: [...closure.files.values()].map(one => one.path).filter(path => path !== modulePath.path).sort(),
        shim,
        caseCount: exercising.length,
        bands: options.bands,
      })
      writeFileSync(join(childDir, ...CASES_FILE.split('/')), `${JSON.stringify(caseEntries(sampleCases(exercising, options.maxCases)), null, 2)}\n`)
      writeFileSync(join(childDir, 'task.json'), `${JSON.stringify(task, null, 2)}\n`)
      writeFileSync(join(childDir, 'README.md'), publicReadme(task, analysis.types))
      written.push({ directory, id: task.id, tier: task.tier, source: tree.source.name })
      tally.written += 1
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2), DEFAULTS)
  const sources = parseSourceManifest(readFileSync(options.sourcesPath, 'utf8'), options.sourcesPath)
  if (options.only !== undefined) {
    const unknown = options.only.filter(name => !sources.some(source => source.name === name))
    if (unknown.length > 0) throw new Error(`synthesize-public-tasks: --only names sources the allowlist lacks: ${unknown.join(', ')}`)
  }
  mkdirSync(options.cacheDir, { recursive: true })
  if (!options.dryRun) {
    rmSync(options.outDir, { recursive: true, force: true })
    mkdirSync(options.outDir, { recursive: true })
  }
  const tallies: SourceTally[] = []
  const run: RunTally = { skips: {}, casesDroppedByReference: 0, candidates: 0 }
  const written: WrittenChild[] = []
  for (const source of sources) {
    const tally: SourceTally = {
      source, status: 'read', reason: undefined, modules: 0, tests: 0, testsUsable: 0,
      testsRejected: {}, blocksDropped: {}, blocksSkipped: {}, candidates: 0, written: 0, admitted: 0,
    }
    tallies.push(tally)
    if (options.only !== undefined && !options.only.includes(source.name)) {
      tally.status = 'dropped'
      tally.reason = 'not named by --only'
      continue
    }
    const fetched = fetchSource(source, options.cacheDir)
    if ('failure' in fetched) {
      tally.status = 'dropped'
      tally.reason = fetched.failure
      console.error(`drop source ${source.name}: ${fetched.failure}`)
      continue
    }
    const license = readLicense(source, fetched.dir)
    if ('failure' in license) {
      tally.status = 'dropped'
      tally.reason = license.failure
      console.error(`drop source ${source.name}: ${license.failure}`)
      continue
    }
    const tree = new SourceTree(source, fetched.dir)
    await deriveSource(tree, license, tally, run, options, written)
    console.error(`read ${source.name}: ${tally.modules} modules, ${tally.tests} tests (${tally.testsUsable} usable), ${tally.candidates} candidates, ${tally.written} written`)
  }

  let admitted = new Set<string>()
  let refused: Refusal[] = []
  if (options.admit) {
    ({ admitted, refused } = admitAndPrune(options))
    for (const one of written) {
      if (admitted.has(one.id)) (tallies.find(tally => tally.source.name === one.source) as SourceTally).admitted += 1
    }
  }
  const census: PublicCensus = {
    sources: tallies.map(sourceCensus),
    modules: tallies.reduce((sum, one) => sum + one.modules, 0),
    tests: tallies.reduce((sum, one) => sum + one.tests, 0),
    candidates: run.candidates,
    skips: sortedRecord(run.skips),
    casesDroppedByReference: run.casesDroppedByReference,
    written: written.length,
    writtenByTier: tally(written.map(one => one.tier)),
    admitted: admitted.size,
    admittedByTier: tally(written.filter(one => admitted.has(one.id)).map(one => one.tier)),
    refused: refused.length,
    refusedByReason: tally(refused.map(one => reasonCategory(one.reason))),
  }
  if (!options.dryRun) writeFileSync(join(options.outDir, CENSUS_FILE), `${JSON.stringify(census, null, 2)}\n`)
  for (const one of census.sources) {
    console.log(`source ${one.name}: ${one.status}${one.reason === undefined ? '' : ` (${one.reason})`}, modules ${one.modules}, tests ${one.tests} usable ${one.testsUsable}, candidates ${one.candidates}, written ${one.written}, admitted ${one.admitted}`)
    if (Object.keys(one.testsRejected).length > 0) console.log(`  tests rejected by reason: ${JSON.stringify(one.testsRejected)}`)
    if (Object.keys(one.blocksDropped).length > 0) console.log(`  blocks dropped by reason: ${JSON.stringify(one.blocksDropped)}`)
    if (Object.keys(one.blocksSkipped).length > 0) console.log(`  blocks skipped by form: ${JSON.stringify(one.blocksSkipped)}`)
  }
  console.log(`modules: ${census.modules}, tests: ${census.tests}, candidates: ${census.candidates}`)
  console.log(`skipped candidates by reason: ${JSON.stringify(census.skips)}`)
  console.log(`cases the reference failed (dropped): ${census.casesDroppedByReference}`)
  if (options.dryRun) return
  console.log(`written: ${census.written}`)
  console.log(`by tier: ${JSON.stringify(census.writtenByTier)}`)
  if (!options.admit) return
  console.log(`admitted: ${census.admitted}`)
  console.log(`admitted by tier: ${JSON.stringify(census.admittedByTier)}`)
  console.log(`refused: ${census.refused}`)
  console.log(`refused by reason: ${JSON.stringify(census.refusedByReason)}`)
}

await main()
