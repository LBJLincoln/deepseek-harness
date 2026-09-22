#!/usr/bin/env node
/**
 * Environment factory: derives function-implementation tasks from this
 * repository's own tested code. For every module under
 * `<packages-dir>/<package>/src/*.ts` whose spec under `<package>/tests/`
 * imports only that module and `vitest`, binds only `describe`/`it`/`test`/
 * `expect`, and asserts only through the matcher subset `expect-shim.mjs`
 * implements, and for every exported function of that module that carries a
 * JSDoc block, this writes a child under
 * `environments-repository/<package>--<function>/`: the module transpiled to
 * plain ESM JavaScript with that one function's body replaced by
 * `throw new Error('not implemented')` (every other export intact), a
 * `README.md` that is task content (the prompt plus the type declarations the
 * build erased), a `package.json`, the transpiled reference under
 * `reference/src/`, and under `reference/cases.json` one hidden case per
 * `it` block that exercises the function — a self-contained ESM program
 * `node --input-type=module` reads from standard input, exit 0 on pass and
 * non-zero with the assertion message on fail. The prompt names the file, the
 * function, and hands over the JSDoc and the TypeScript signature; it never
 * reveals the spec.
 *
 * The factory runs every case against the transpiled reference first and
 * skips a module whose reference fails any case, since that is the shim or
 * the transform falling short, not the module; then per function it runs the
 * cases against the stub and keeps the ones that fail, which are the cases
 * that reach the function. A function no case reaches yields no child. A
 * child's tier is set by that count (`--tier-bands`). Every child is
 * `heldOut: false`; the family has no parent whose split it could inherit.
 *
 * Deterministic: packages, modules, specs, and functions are processed in
 * sorted or source order, so two runs over the same tree produce identical
 * output. Idempotent: `--out-dir` is removed and rewritten whole on every
 * real run, never patched in place.
 *
 *   node synthesize-repository-tasks.ts [options]
 *
 * Options:
 *   --packages-dir <path>    package directories to read (default: the repository's packages/util)
 *   --out-dir <path>         where children are written (default: ../environments-repository)
 *   --min-lines <n>          skip a function whose body has fewer lines (default: 1)
 *   --tier-bands <a,b>       tier 3 from a exercising cases, tier 4 from b (default: 4,12)
 *   --case-timeout-ms <n>    how long one case program may run (default: 20000)
 *   --dry-run                print the modules, their skip reasons, and the candidate functions; run nothing and
 *                            write nothing; incompatible with --admit
 *   --admit                  after writing, run admit.mjs over --out-dir, delete every child it rejects, and record
 *                            why in REFUSED.json
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  analyzeModule,
  analyzeSpec,
  analyzeSpecImports,
  caseEntries,
  CASES_FILE,
  childId,
  childReadme,
  childTaskJson,
  importsOnlyModule,
  MODULE_FILE,
  parseArgs,
  stubFunction,
  transpile,
} from './repository-environments.ts'
import type { FactoryOptions, ModuleAnalysis, ModuleFunction, RepositorySource, SpecCase } from './repository-environments.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const BENCH_ROOT = join(HERE, '..')
const REPO_ROOT = resolve(BENCH_ROOT, '..', '..', '..', '..', '..')
const SHIM = readFileSync(join(HERE, 'expect-shim.mjs'), 'utf8')

const DEFAULTS: FactoryOptions = {
  packagesDir: join(REPO_ROOT, 'packages', 'util'),
  outDir: join(BENCH_ROOT, 'environments-repository'),
  repoRoot: REPO_ROOT,
  minLines: 1,
  bands: { tier3From: 4, tier4From: 12 },
  caseTimeoutMs: 20_000,
  dryRun: false,
  admit: false,
}

/** A repository-relative POSIX path, as the `repository` field records it. */
function repoPath(options: FactoryOptions, path: string): string {
  return relative(options.repoRoot, path).split(sep).join('/')
}

// --- Discovery -------------------------------------------------------------------

/** One module and the spec that judges it, before any transpiling. */
interface ModuleCandidate {
  readonly packageDir: string
  readonly packageName: string
  readonly modulePath: string
  readonly specPath: string
  readonly moduleSpecifiers: readonly string[]
}

/** Why one module yields no children, as the census prints it. */
interface ModuleSkip {
  readonly modulePath: string
  readonly reason: string
}

interface PackageEntry {
  readonly dir: string
  readonly dirName: string
  readonly name: string
}

function readPackages(packagesDir: string): PackageEntry[] {
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(packagesDir, entry.name, 'package.json')))
    .map((entry) => {
      const dir = join(packagesDir, entry.name)
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: string }
      if (typeof manifest.name !== 'string') throw new Error(`synthesize-repository-tasks: ${dir}/package.json has no name`)
      return { dir, dirName: entry.name, name: manifest.name }
    })
    .sort((left, right) => left.dirName.localeCompare(right.dirName))
}

function sourceFiles(dir: string, suffixes: readonly string[]): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && suffixes.some(suffix => entry.name.endsWith(suffix)) && !entry.name.endsWith('.d.ts'))
    .map(entry => entry.name)
    .sort()
}

/**
 * Pairs every module of every package with the spec that imports only it and
 * `vitest`, and records why the others pair with none.
 */
function discoverModules(options: FactoryOptions): { candidates: ModuleCandidate[]; skipped: ModuleSkip[]; packages: number } {
  const candidates: ModuleCandidate[] = []
  const skipped: ModuleSkip[] = []
  const packages = readPackages(options.packagesDir)
  for (const pkg of packages) {
    const specs = sourceFiles(join(pkg.dir, 'tests'), ['.spec.ts', '.test.ts'])
      .map(name => ({ path: join(pkg.dir, 'tests', name), imports: analyzeSpecImports(readFileSync(join(pkg.dir, 'tests', name), 'utf8'), name) }))
    for (const moduleName of sourceFiles(join(pkg.dir, 'src'), ['.ts'])) {
      const modulePath = join(pkg.dir, 'src', moduleName)
      const base = moduleName.slice(0, -'.ts'.length)
      const moduleSpecifiers = base === 'index' ? [`../src/${moduleName}`, pkg.name] : [`../src/${moduleName}`]
      const importing = specs.filter(spec => spec.imports.runtime.some(specifier => moduleSpecifiers.includes(specifier)))
      if (importing.length === 0) {
        skipped.push({ modulePath, reason: 'no spec imports it' })
        continue
      }
      const clean = importing.find(spec => importsOnlyModule(spec.imports, moduleSpecifiers) === undefined)
      if (clean === undefined) {
        const [first] = importing
        const reason = first === undefined ? 'no spec imports it' : importsOnlyModule(first.imports, moduleSpecifiers) ?? 'no spec imports it'
        skipped.push({ modulePath, reason: `spec ${basename(first?.path ?? '')} ${reason}` })
        continue
      }
      candidates.push({ packageDir: pkg.dirName, packageName: pkg.name, modulePath, specPath: clean.path, moduleSpecifiers })
    }
  }
  return { candidates, skipped, packages: packages.length }
}

// --- Case execution ----------------------------------------------------------------

/** The one failure line a case program leaves on stderr: the thrown error's own line, or the last line. */
function failureLine(stderr: string): string {
  const lines = stderr.split('\n').map(line => line.trim()).filter(line => line !== '')
  return lines.find(line => /^\w*Error: /u.test(line)) ?? lines.at(-1) ?? 'exited non-zero'
}

/** Runs one case program in `cwd`; `undefined` on exit 0, otherwise the failure line. */
function runCase(cwd: string, program: string, options: FactoryOptions): string | undefined {
  const result = spawnSync(process.execPath, ['--input-type=module'], { cwd, input: program, encoding: 'utf8', timeout: options.caseTimeoutMs })
  if (result.status === 0) return undefined
  if (result.error !== undefined) return result.error.message
  return failureLine(result.stderr)
}

/** One case a program failed, with the failure line it left. */
interface FailedCase {
  readonly one: SpecCase
  readonly failure: string
}

/** The cases the program in `cwd` fails, with the failure line of each. */
function failingCases(cwd: string, cases: readonly SpecCase[], options: FactoryOptions): FailedCase[] {
  const failing: FailedCase[] = []
  for (const one of cases) {
    const failure = runCase(cwd, one.program, options)
    if (failure !== undefined) failing.push({ one, failure })
  }
  return failing
}

/** `undefined` when `filePath` parses as JavaScript, the first line of `node --check`'s complaint otherwise. */
function syntaxError(filePath: string): string | undefined {
  const result = spawnSync(process.execPath, ['--check', filePath], { encoding: 'utf8' })
  if (result.status === 0) return undefined
  return (result.stderr || result.stdout || 'node --check failed').trim().split('\n')[0]
}

// --- Module preparation ------------------------------------------------------------------

/** One module transpiled, analyzed, and paired with the cases its spec yields, ready to stub. */
interface PreparedModule {
  readonly candidate: ModuleCandidate
  readonly source: RepositorySource
  readonly analysis: ModuleAnalysis
  readonly js: string
  readonly cases: readonly SpecCase[]
  /** The functions eligible for a child, with the reasons the rest were set aside. */
  readonly eligible: readonly ModuleFunction[]
  readonly skippedNoJsDoc: number
  readonly skippedShort: number
}

/** Transpiles and analyzes one module and its spec; a skip reason instead when either disqualifies the module. */
function prepareModule(candidate: ModuleCandidate, options: FactoryOptions): PreparedModule | ModuleSkip {
  const moduleSource = readFileSync(candidate.modulePath, 'utf8')
  const analysis = analyzeModule(moduleSource, candidate.modulePath)
  const withJsDoc = analysis.functions.filter(fn => fn.jsDoc !== '')
  const eligible = withJsDoc.filter(fn => fn.bodyLines >= options.minLines)
  if (eligible.length === 0) return { modulePath: candidate.modulePath, reason: 'no exported block-bodied function with JSDoc and a long enough body' }
  const specSource = readFileSync(candidate.specPath, 'utf8')
  const spec = analyzeSpec(transpile(specSource, candidate.specPath), candidate.specPath, {
    moduleSpecifiers: candidate.moduleSpecifiers,
    moduleImport: `./${MODULE_FILE}`,
    shim: SHIM,
  })
  if (spec.kind === 'rejected') return { modulePath: candidate.modulePath, reason: `spec ${basename(candidate.specPath)} ${spec.reason}` }
  return {
    candidate,
    source: {
      package: candidate.packageName,
      module: repoPath(options, candidate.modulePath),
      spec: repoPath(options, candidate.specPath),
    },
    analysis,
    js: transpile(moduleSource, candidate.modulePath),
    cases: spec.cases,
    eligible,
    skippedNoJsDoc: analysis.functions.length - withJsDoc.length,
    skippedShort: withJsDoc.length - eligible.length,
  }
}

/** Runs every case against the transpiled reference in a scratch workspace; the first failure disqualifies the module. */
function referenceFailure(prepared: PreparedModule, options: FactoryOptions): string | undefined {
  const scratch = mkdtempSync(join(tmpdir(), 'repository-reference-'))
  try {
    mkdirSync(join(scratch, dirname(MODULE_FILE)), { recursive: true })
    writeFileSync(join(scratch, MODULE_FILE), prepared.js)
    const [first] = failingCases(scratch, prepared.cases, options)
    return first === undefined ? undefined : `reference fails case ${first.one.ordinal} "${first.one.title}": ${first.failure}`
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

// --- Child writing ---------------------------------------------------------------------

/** One written child, as the census and admission track it. */
interface WrittenChild {
  readonly childId: string
  readonly id: string
  readonly tier: number
}

/** Writes the child's workspace and reference; the case file and task follow once the exercising cases are known. */
function writeWorkspace(childDir: string, packageDir: string, stub: string, reference: string): void {
  rmSync(childDir, { recursive: true, force: true })
  mkdirSync(join(childDir, dirname(MODULE_FILE)), { recursive: true })
  mkdirSync(join(childDir, 'reference', dirname(MODULE_FILE)), { recursive: true })
  writeFileSync(join(childDir, MODULE_FILE), stub)
  writeFileSync(join(childDir, 'reference', MODULE_FILE), reference)
  writeFileSync(join(childDir, 'package.json'), `${JSON.stringify({ name: packageDir, type: 'module', private: true }, null, 2)}\n`)
}

// --- Admission ----------------------------------------------------------------------------

/** One child `admit.mjs` rejected: its directory and the reason line. */
interface Refusal {
  readonly name: string
  readonly reason: string
}

/** What one `admit.mjs` run decided: the admitted task ids and the refusals. */
interface Admission {
  readonly admitted: string[]
  readonly refused: Refusal[]
}

/** Parses one `admit.mjs` run's stdout/stderr into admitted ids and `{ name, reason }` refusals. */
function parseAdmission(stdout: string, stderr: string): Admission {
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
  if (first.startsWith('pre-state passes')) return 'pre-state passes (the stub is not reached)'
  if (first.startsWith('reference fails its tests')) return 'reference fails its tests'
  if (first.includes('the reference misses')) return 'reference misses a case'
  if (first.includes('the pre-state passes every case')) return 'pre-state passes every case'
  if (first.startsWith('task.json lacks')) return 'task.json missing a required field'
  if (first.startsWith('no reference/src')) return 'no reference/src'
  if (first.startsWith('node_modules present')) return 'node_modules present'
  if (first.includes('does not match directory')) return 'id does not match directory'
  return first
}

/**
 * Runs `admit.mjs` over `options.outDir`, deletes every child it rejects, and
 * writes their reasons to `REFUSED.json`, sorted by child directory name.
 */
function admitAndPrune(options: FactoryOptions, written: readonly WrittenChild[]): Admission & { readonly admittedTiers: number[] } {
  const result = spawnSync(process.execPath, [join(BENCH_ROOT, 'admit.mjs'), options.outDir], { encoding: 'utf8' })
  const { admitted, refused } = parseAdmission(result.stdout, result.stderr)
  for (const { name } of refused) rmSync(join(options.outDir, name), { recursive: true, force: true })
  refused.sort((left, right) => left.name.localeCompare(right.name))
  writeFileSync(
    join(options.outDir, 'REFUSED.json'),
    `${JSON.stringify(refused.map(one => ({ ...one, category: reasonCategory(one.reason) })), null, 2)}\n`,
  )
  const admittedSet = new Set(admitted)
  // admit.mjs's "admit" line names the task id, its "REJECT" line the
  // directory; `written` carries both.
  const admittedTiers = written.filter(one => admittedSet.has(one.id)).map(one => one.tier)
  return { admitted, refused, admittedTiers }
}

// --- Reporting ------------------------------------------------------------------------------

/** Counts `values` into a sorted `{ key: count }` object, for a per-tier or per-reason breakdown. */
function tally(values: readonly (string | number)[]): Record<string, number> {
  const counts = new Map<string | number, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return Object.fromEntries([...counts.entries()].sort((left, right) => (String(left[0]) > String(right[0]) ? 1 : -1)))
}

/** A module skip reason's category, so the census groups the many specs one import rule set aside. */
function skipCategory(reason: string): string {
  if (reason === 'no spec imports it') return 'no spec imports the module'
  if (/ imports \S+ from vitest$/u.test(reason)) return 'spec imports a vitest binding outside describe/it/test/expect'
  if (/ imports /u.test(reason)) return 'spec imports outside the module and vitest'
  if (reason.includes('outside the subset') || reason.includes('uses expect')) return 'spec uses a matcher outside the subset'
  if (reason.includes('reference fails case')) return 'reference fails a case'
  if (reason.startsWith('no exported block-bodied function')) return 'no exported block-bodied function with JSDoc'
  return reason
}

function main(): void {
  const options = parseArgs(process.argv.slice(2), DEFAULTS)
  if (!existsSync(options.packagesDir)) throw new Error(`synthesize-repository-tasks: no packages directory at ${options.packagesDir}`)
  const discovered = discoverModules(options)
  const skips: ModuleSkip[] = [...discovered.skipped]
  const prepared: PreparedModule[] = []
  for (const candidate of discovered.candidates) {
    const outcome = prepareModule(candidate, options)
    if ('reason' in outcome) skips.push(outcome)
    else prepared.push(outcome)
  }

  if (options.dryRun) {
    for (const skip of skips) console.log(`skip ${repoPath(options, skip.modulePath)}: ${skip.reason}`)
    for (const one of prepared) {
      for (const fn of one.eligible) console.log(`would consider ${childId(one.candidate.packageDir, fn.name)} (spec cases: ${one.cases.length})`)
    }
    console.log(`packages: ${discovered.packages}, modules: ${discovered.candidates.length + discovered.skipped.length}, modules with a spec to derive from: ${prepared.length}`)
    console.log(`skipped modules by reason: ${JSON.stringify(tally(skips.map(skip => skipCategory(skip.reason))))}`)
    console.log(`candidate functions: ${prepared.reduce((sum, one) => sum + one.eligible.length, 0)}`)
    return
  }

  rmSync(options.outDir, { recursive: true, force: true })
  mkdirSync(options.outDir, { recursive: true })
  const written: WrittenChild[] = []
  const counts = { candidates: 0, skippedNoJsDoc: 0, skippedShort: 0, skippedUnreached: 0, droppedSyntax: 0 }
  for (const one of prepared) {
    const failure = referenceFailure(one, options)
    if (failure !== undefined) {
      skips.push({ modulePath: one.candidate.modulePath, reason: failure })
      continue
    }
    counts.skippedNoJsDoc += one.skippedNoJsDoc
    counts.skippedShort += one.skippedShort
    for (const fn of one.eligible) {
      counts.candidates += 1
      const directory = childId(one.candidate.packageDir, fn.name)
      const childDir = join(options.outDir, directory)
      writeWorkspace(childDir, one.candidate.packageDir, stubFunction(one.js, fn.name, one.candidate.modulePath), one.js)
      const stubProblem = syntaxError(join(childDir, MODULE_FILE))
      if (stubProblem !== undefined) {
        rmSync(childDir, { recursive: true, force: true })
        counts.droppedSyntax += 1
        console.error(`drop ${directory}: stub does not parse: ${stubProblem}`)
        continue
      }
      const exercising = failingCases(childDir, one.cases, options).map(failed => failed.one)
      if (exercising.length === 0) {
        rmSync(childDir, { recursive: true, force: true })
        counts.skippedUnreached += 1
        console.error(`skip ${directory}: no case exercises ${fn.name}`)
        continue
      }
      const task = childTaskJson({
        packageDir: one.candidate.packageDir,
        functionName: fn.name,
        source: one.source,
        jsDoc: fn.jsDoc,
        signature: fn.signature,
        caseCount: exercising.length,
        bands: options.bands,
      })
      writeFileSync(join(childDir, CASES_FILE), `${JSON.stringify(caseEntries(exercising), null, 2)}\n`)
      writeFileSync(join(childDir, 'task.json'), `${JSON.stringify(task, null, 2)}\n`)
      writeFileSync(join(childDir, 'README.md'), childReadme(task, one.analysis.types))
      written.push({ childId: directory, id: task.id, tier: task.tier })
    }
  }
  for (const skip of skips) console.error(`skip ${repoPath(options, skip.modulePath)}: ${skip.reason}`)

  console.log(`packages: ${discovered.packages}, modules: ${discovered.candidates.length + discovered.skipped.length}, modules with a spec to derive from: ${prepared.length - skips.filter(skip => skip.reason.startsWith('reference fails')).length}`)
  console.log(`skipped modules by reason: ${JSON.stringify(tally(skips.map(skip => skipCategory(skip.reason))))}`)
  console.log(`candidates: ${counts.candidates}, skipped (no JSDoc): ${counts.skippedNoJsDoc}, skipped (too short): ${counts.skippedShort}, skipped (no case exercises it): ${counts.skippedUnreached}, dropped (stub did not parse): ${counts.droppedSyntax}`)
  console.log(`written: ${written.length}`)
  console.log(`by tier: ${JSON.stringify(tally(written.map(one => one.tier)))}`)

  if (!options.admit) return
  const { admitted, refused, admittedTiers } = admitAndPrune(options, written)
  console.log(`admitted: ${admitted.length}`)
  console.log(`admitted by tier: ${JSON.stringify(tally(admittedTiers))}`)
  console.log(`refused: ${refused.length}`)
  console.log(`refused by reason: ${JSON.stringify(tally(refused.map(one => reasonCategory(one.reason))))}`)
}

main()
