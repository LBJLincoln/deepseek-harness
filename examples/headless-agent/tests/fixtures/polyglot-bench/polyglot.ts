/**
 * The polyglot bench's exercise model, shared by its registrar and its
 * admission so both read one definition: which tracks of the aider polyglot
 * benchmark run offline in a sealed cell, what one exercise of a checkout
 * becomes as a staged fixture, which files the implementer may change, the
 * command that judges it, where its reference solution goes, the prompt, and
 * which exercises are held out.
 *
 * A sealed cell binds `/` read-only, gives the command a private `/tmp`, and
 * lets it write only its workspace, so every command keeps its build output in
 * the workspace or in `/tmp` and fetches nothing. The implementer is told the
 * same command the check runs.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, posix, relative, sep } from 'node:path'

/**
 * The tracks registered, in registration order. JavaScript needs `jest`
 * installed into `node_modules` and Java needs Gradle, neither of which a
 * sealed cell can fetch, so those two tracks of the benchmark are not.
 */
export const POLYGLOT_LANGUAGES = ['cpp', 'go', 'python', 'rust'] as const

/** One registered track. */
export type PolyglotLanguage = (typeof POLYGLOT_LANGUAGES)[number]

/**
 * The command that judges an exercise of each track, run in the workspace
 * root: the check's `run`, and the command the prompt names. Go keeps its build
 * cache in the cell's private `/tmp`, because the home directory is read-only
 * in a cell, and may fetch nothing. The Rust suites mark every test but the
 * first `#[ignore]` and the C++ suites compile every test but the first only
 * under `EXERCISM_RUN_ALL_TESTS`; both switches are on, as in aider's harness.
 * The C++ build directory is recreated, so a cache configured by the
 * implementer cannot decide the build.
 */
export const POLYGLOT_TEST_COMMANDS: Readonly<Record<PolyglotLanguage, string>> = {
  cpp: 'rm -rf build && cmake -S . -B build -DEXERCISM_RUN_ALL_TESTS=1 && cmake --build build',
  go: 'GOCACHE=/tmp/go-build GOPROXY=off GOTOOLCHAIN=local go test -count=1 ./...',
  python: 'python3 -m pytest -q',
  rust: 'cargo test --offline -- --include-ignored',
}

/**
 * The exercise's metadata directory. It holds the reference solution
 * (`example.*`), so a staged fixture keeps it whole as the task reference: the
 * runner removes it from every workspace and stages it for the validator only.
 */
export const REFERENCE_DIRECTORY = '.meta'

/**
 * Build manifests a track lists among its solution files. They stay fixed, as
 * aider's harness keeps them: a cell cannot fetch a dependency one could add.
 */
const FIXED_MANIFESTS = ['CMakeLists.txt', 'Cargo.toml']

/**
 * The line of every C++ `CMakeLists.txt` that names the exercise after the
 * directory it is built in. A cell's workspace is named after the cell, so the
 * staged file names the exercise outright instead.
 */
const CMAKE_NAME_LINE = 'get_filename_component(exercise ${CMAKE_CURRENT_SOURCE_DIR} NAME)'

/** Share of each track's admitted exercises held out for evaluation. */
export const HELD_OUT_SHARE = 0.2

/** Seed of the hash that ranks each track's exercises for the held-out split; changing it moves exercises across the split. */
const HELD_OUT_SEED = 'aider-polyglot-benchmark held-out split v1'

/** One exercise of a checkout, as its `.meta/config.json` declares it. */
export interface PolyglotExercise {
  /** The environment id, `polyglot:<language>:<exercise>`. */
  readonly id: string
  /** The track the exercise belongs to. */
  readonly language: PolyglotLanguage
  /** The exercise's directory name, e.g. `affine-cipher`. */
  readonly name: string
  /** Absolute path of the exercise directory inside the checkout. */
  readonly directory: string
  /** Workspace-relative files the implementer changes: the track's solution files without its build manifest. */
  readonly editable: readonly string[]
  /** Each reference file under `.meta/`, paired with the editable file it replaces. */
  readonly references: readonly { readonly from: string; readonly to: string }[]
}

/** A refused exercise and why admission refused it. */
export interface PolyglotRefusal {
  /** The exercise's environment id. */
  readonly id: string
  /** What admission observed. */
  readonly reason: string
}

/**
 * The outcome of admission over one checkout, as `admission.json` records it.
 * The revision it ran against is the revision the registrar accepts, and every
 * exercise of the registered tracks is either admitted or refused.
 */
export interface PolyglotAdmission {
  /** The benchmark repository the checkout was cloned from. */
  readonly repository: string
  /** The commit admission ran against. */
  readonly revision: string
  /** Per track, the toolchain versions admission ran under. */
  readonly toolchains: Readonly<Record<PolyglotLanguage, string>>
  /** Environment ids whose stub failed its tests and whose reference passed them, sorted. */
  readonly admitted: readonly string[]
  /** Environment ids admission refused, sorted, each with its reason. */
  readonly refused: readonly PolyglotRefusal[]
}

/**
 * The environment id of one exercise.
 * @param language - the exercise's track.
 * @param name - the exercise's directory name.
 * @returns `polyglot:<language>:<name>`.
 */
export function polyglotId(language: PolyglotLanguage, name: string): string {
  return `polyglot:${language}:${name}`
}

/** The track a `polyglot:<language>:<exercise>` id names, refused unless it names a registered one. */
function languageOf(id: string): PolyglotLanguage {
  const language = POLYGLOT_LANGUAGES.find(candidate => id.startsWith(`polyglot:${candidate}:`))
  if (language === undefined) throw new Error(`polyglot-bench: ${id} names no registered track`)
  return language
}

/** Whether `path` is a `/`-separated relative path with no empty, `.`, or `..` segment. */
function isRelativePath(path: string): boolean {
  return path !== '' && posix.normalize(path) === path && !path.startsWith('/') && !path.split('/').includes('..') && !path.includes('\\')
}

/**
 * A list of relative paths as a JSON file states it, refused unless it is one.
 * @param value - the parsed field.
 * @param subject - the file and field, as the refusal names them.
 * @returns the paths.
 */
function pathList(value: unknown, subject: string): string[] {
  if (!Array.isArray(value)) throw new Error(`polyglot-bench: ${subject} is not a list`)
  const entries: unknown[] = value
  return entries.map((entry) => {
    if (typeof entry !== 'string' || !isRelativePath(entry)) throw new Error(`polyglot-bench: ${subject} holds ${JSON.stringify(entry)}, which is not a normalized relative path`)
    return entry
  })
}

/** The object a parsed JSON value holds, refused unless it is one. */
function objectOf(value: unknown, subject: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`polyglot-bench: ${subject} is not an object`)
  return value as Record<string, unknown>
}

/**
 * The exercise directory names of one track in a checkout, sorted.
 * @param checkout - absolute path of the checkout.
 * @param language - the track.
 * @returns the names.
 */
export function listExercises(checkout: string, language: PolyglotLanguage): string[] {
  const root = join(checkout, language, 'exercises', 'practice')
  if (!existsSync(root)) throw new Error(`polyglot-bench: ${checkout} holds no ${language}/exercises/practice directory`)
  return readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
}

/**
 * Read one exercise from its `.meta/config.json`: its editable files are its
 * solution files without the build manifest, and each reference file replaces
 * the one editable file that shares its extension.
 * @param checkout - absolute path of the checkout.
 * @param language - the exercise's track.
 * @param name - the exercise's directory name.
 * @returns the exercise.
 */
export function readExercise(checkout: string, language: PolyglotLanguage, name: string): PolyglotExercise {
  const id = polyglotId(language, name)
  const directory = join(checkout, language, 'exercises', 'practice', name)
  const subject = `${id} .meta/config.json`
  const config = objectOf(JSON.parse(readFileSync(join(directory, REFERENCE_DIRECTORY, 'config.json'), 'utf8')), subject)
  const files = objectOf(config.files, `${subject} files`)
  const editable = pathList(files.solution, `${subject} files.solution`).filter(path => !FIXED_MANIFESTS.includes(path))
  const examples = pathList(files.example, `${subject} files.example`)
  if (editable.length === 0) throw new Error(`polyglot-bench: ${subject} names no editable solution file`)
  if (examples.length === 0) throw new Error(`polyglot-bench: ${subject} names no reference file`)
  const references = examples.map((from) => {
    if (!from.startsWith(`${REFERENCE_DIRECTORY}/`)) throw new Error(`polyglot-bench: ${subject} names the reference file ${from} outside ${REFERENCE_DIRECTORY}/`)
    const targets = editable.filter(path => posix.extname(path) === posix.extname(from))
    const [to] = targets
    if (targets.length !== 1 || to === undefined) {
      throw new Error(`polyglot-bench: ${subject} reference file ${from} shares its extension with ${targets.length} editable files, not one`)
    }
    return { from, to }
  })
  return { id, language, name, directory, editable, references }
}

/** Every file under `root`, as sorted `/`-separated paths relative to it. */
function filesUnder(root: string): string[] {
  const files: string[] = []
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else files.push(relative(root, path).split(sep).join('/'))
    }
  }
  walk(root)
  return files.sort()
}

/**
 * Stage one exercise as a fixture directory. Every entry of the exercise
 * directory is copied except its dot-directories — `.docs`, whose text is the
 * prompt, and `.approaches` and `.articles`, which carry worked solutions —
 * while `.meta` is kept whole as the reference. A C++ `CMakeLists.txt` names
 * its exercise outright rather than after the directory it is built in.
 * @param exercise - the exercise to stage.
 * @param target - the fixture directory to create; it must not exist yet.
 * @returns the immutable set: every staged file outside `.meta` that is not editable, sorted.
 */
export function stageExercise(exercise: PolyglotExercise, target: string): string[] {
  if (existsSync(target)) throw new Error(`polyglot-bench: staging ${exercise.id} into ${target}, which already exists`)
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(exercise.directory)) {
    if (entry.startsWith('.') && entry !== REFERENCE_DIRECTORY) continue
    cpSync(join(exercise.directory, entry), join(target, entry), { recursive: true })
  }
  if (exercise.language === 'cpp') {
    const path = join(target, 'CMakeLists.txt')
    const text = readFileSync(path, 'utf8')
    if (text.split(CMAKE_NAME_LINE).length !== 2) throw new Error(`polyglot-bench: ${exercise.id} CMakeLists.txt does not name its exercise by the one line the fixture rewrites`)
    writeFileSync(path, text.replace(CMAKE_NAME_LINE, `set(exercise ${exercise.name})`))
  }
  const workspaceFiles = filesUnder(target).filter(path => !path.startsWith(`${REFERENCE_DIRECTORY}/`))
  for (const path of exercise.editable) {
    if (!workspaceFiles.includes(path)) throw new Error(`polyglot-bench: ${exercise.id} ships no stub for its editable file ${path}`)
  }
  return workspaceFiles.filter(path => !exercise.editable.includes(path))
}

/**
 * Copy the reference files over the editable files they replace, as admission
 * does to show that the reference passes the exercise's tests.
 * @param exercise - the exercise whose reference to apply.
 * @param fixture - the staged fixture holding `.meta`.
 * @param workspace - the workspace the stubs were copied into.
 */
export function applyReference(exercise: PolyglotExercise, fixture: string, workspace: string): void {
  for (const { from, to } of exercise.references) cpSync(join(fixture, from), join(workspace, to))
}

/**
 * The task prompt: the exercise's introduction when it has one, its
 * instructions, and its instructions appendix when it has one — the text
 * aider's harness sends — then one sentence naming the files to change and the
 * command that judges them.
 * @param exercise - the exercise.
 * @returns the prompt.
 */
export function exercisePrompt(exercise: PolyglotExercise): string {
  const docs = join(exercise.directory, '.docs')
  const sections = ['introduction.md', 'instructions.md', 'instructions.append.md']
    .filter(file => file === 'instructions.md' || existsSync(join(docs, file)))
    .map(file => readFileSync(join(docs, file), 'utf8').trim())
  const files = exercise.editable.map(path => `\`${path}\``)
  const named = files.length === 1 ? files.join('') : `${files.slice(0, -1).join(', ')} and ${files.slice(-1).join('')}`
  const rule = `Change only ${named}, keeping the names the tests use and nothing beyond the standard library, so that \`${POLYGLOT_TEST_COMMANDS[exercise.language]}\` passes in the workspace root; every other file stays as it is.`
  return `${sections.join('\n\n')}\n\n${rule}`
}

/** One track's admitted exercises, split. */
interface PolyglotSplit {
  /** The held-out ids. */
  readonly heldOut: readonly string[]
  /** The other ids, in rank order: the order the checked-in plans take exercises in. */
  readonly open: readonly string[]
}

/**
 * The held-out split of one track: its admitted exercises ranked by a seeded
 * SHA-256 of their ids, the first fifth held out and the rest open. The rank of
 * one id depends on that id alone, so admitting or refusing another exercise
 * moves at most the boundary of the split.
 * @param admitted - every admitted environment id.
 * @param language - the track to split.
 * @returns the track's held-out and open ids, each in rank order.
 */
export function splitTrack(admitted: readonly string[], language: PolyglotLanguage): PolyglotSplit {
  const rank = (id: string): string => createHash('sha256').update(`${HELD_OUT_SEED}\n${id}`).digest('hex')
  const ids = admitted.filter(id => languageOf(id) === language).sort((left, right) => (rank(left) < rank(right) ? -1 : 1))
  const held = Math.round(ids.length * HELD_OUT_SHARE)
  return { heldOut: ids.slice(0, held), open: ids.slice(held) }
}

/**
 * Every held-out id of every track.
 * @param admitted - every admitted environment id.
 * @returns the held-out ids.
 */
export function heldOutIds(admitted: readonly string[]): ReadonlySet<string> {
  return new Set(POLYGLOT_LANGUAGES.flatMap(language => splitTrack(admitted, language).heldOut))
}

/**
 * The commit a checkout has checked out.
 * @param checkout - absolute path of the checkout.
 * @returns the commit id `git rev-parse HEAD` reports.
 */
export function checkoutRevision(checkout: string): string {
  return execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
}

/**
 * What differs from the checked-out commit under the registered tracks'
 * directories: modified, untracked, and ignored paths alike, since a staged
 * fixture copies whatever the exercise directory holds. The index is left
 * untouched.
 * @param checkout - absolute path of the checkout.
 * @returns one `git status --porcelain` line per differing path.
 */
export function checkoutChanges(checkout: string): string[] {
  const status = execFileSync('git', [
    '--no-optional-locks', '-C', checkout, 'status', '--porcelain', '--untracked-files=all', '--ignored', '--', ...POLYGLOT_LANGUAGES,
  ], { encoding: 'utf8' })
  return status.split('\n').filter(line => line !== '')
}

/**
 * Read and validate an admission record.
 * @param path - the record's path.
 * @returns the record.
 */
export function readAdmission(path: string): PolyglotAdmission {
  const record = objectOf(JSON.parse(readFileSync(path, 'utf8')), path)
  const { repository, revision } = record
  if (typeof repository !== 'string' || repository === '') throw new Error(`polyglot-bench: ${path} names no repository`)
  if (typeof revision !== 'string' || !/^[0-9a-f]{40}$/u.test(revision)) throw new Error(`polyglot-bench: ${path} names no full commit id as its revision`)
  const toolchainFields = objectOf(record.toolchains, `${path} toolchains`)
  const toolchains = Object.fromEntries(POLYGLOT_LANGUAGES.map((language) => {
    const version = toolchainFields[language]
    if (typeof version !== 'string' || version === '') throw new Error(`polyglot-bench: ${path} records no ${language} toolchain`)
    return [language, version]
  })) as Record<PolyglotLanguage, string>
  if (!Array.isArray(record.admitted) || !Array.isArray(record.refused)) throw new Error(`polyglot-bench: ${path} lacks its admitted or refused list`)
  const admittedEntries: unknown[] = record.admitted
  const refusedEntries: unknown[] = record.refused
  const admitted = admittedEntries.map((id) => {
    if (typeof id !== 'string') throw new Error(`polyglot-bench: ${path} admits ${JSON.stringify(id)}, which is not an id`)
    languageOf(id)
    return id
  })
  const refused = refusedEntries.map((entry) => {
    const { id, reason } = objectOf(entry, `${path} refusal`)
    if (typeof id !== 'string' || typeof reason !== 'string' || reason === '') throw new Error(`polyglot-bench: ${path} holds a refusal without an id and a reason`)
    languageOf(id)
    return { id, reason }
  })
  const ids = [...admitted, ...refused.map(entry => entry.id)]
  if (new Set(ids).size !== ids.length) throw new Error(`polyglot-bench: ${path} classifies one exercise twice`)
  return { repository, revision, toolchains, admitted, refused }
}

/**
 * Verify that a checkout is the one an admission record describes — the same
 * commit, nothing changed under the registered tracks, and every exercise
 * classified — and read the admitted exercises.
 * @param checkout - absolute path of the checkout.
 * @param admission - the admission record.
 * @returns the admitted exercises, sorted by id.
 */
export function admittedExercises(checkout: string, admission: PolyglotAdmission): PolyglotExercise[] {
  if (!existsSync(checkout) || !statSync(checkout).isDirectory()) throw new Error(`polyglot-bench: the checkout ${checkout} is not a directory`)
  const revision = checkoutRevision(checkout)
  if (revision !== admission.revision) {
    throw new Error(`polyglot-bench: ${checkout} is at ${revision}, and admission ran against ${admission.revision} of ${admission.repository}; check out that revision`)
  }
  const changes = checkoutChanges(checkout)
  if (changes.length > 0) {
    throw new Error(`polyglot-bench: ${checkout} differs from ${revision} under ${POLYGLOT_LANGUAGES.join(', ')}: ${changes.slice(0, 5).join('; ')}${changes.length > 5 ? `; and ${changes.length - 5} more` : ''}`)
  }
  const found = POLYGLOT_LANGUAGES.flatMap(language => listExercises(checkout, language).map(name => polyglotId(language, name)))
  const classified = new Set([...admission.admitted, ...admission.refused.map(entry => entry.id)])
  const unclassified = found.filter(id => !classified.has(id))
  const missing = [...classified].filter(id => !found.includes(id))
  if (unclassified.length > 0 || missing.length > 0) {
    throw new Error(`polyglot-bench: the admission record and ${checkout} disagree: unclassified ${JSON.stringify(unclassified)}, absent ${JSON.stringify(missing)}`)
  }
  return [...admission.admitted].sort().map((id) => {
    const language = languageOf(id)
    return readExercise(checkout, language, id.slice(`polyglot:${language}:`.length))
  })
}
