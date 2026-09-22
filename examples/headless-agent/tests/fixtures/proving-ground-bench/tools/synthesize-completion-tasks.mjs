#!/usr/bin/env node
/**
 * Environment factory: multiplies the Proving Ground bench's hand-authored
 * environments into completion tasks. For every parent under `environments/`
 * whose `task.json` has a `reference/src/*.js` program, and for every
 * top-level `function name(...) { ... }` or `const name = (...) => { ... }`
 * that program declares, this writes a child under
 * `environments-completion/<parent>--<function>/` whose workspace holds the
 * reference solution with that one function's body replaced by
 * `throw new Error('not implemented')` (the signature and any leading
 * comment or JSDoc kept), whose `test/` and `package.json` are the parent's,
 * unchanged, and whose prompt is the parent's prompt plus a paragraph naming
 * the file and function to complete and forbidding edits elsewhere.
 *
 * A completion child's checks drop every check the parent judges by hidden
 * cases: it is judged on the visible suite alone, so its certificate says the
 * function passes the tests an implementer can read, never that it matches a
 * validator's held-back corpus.
 *
 * Deterministic: parents, the files within a parent's `reference/src/`, and
 * the functions within a file are all processed in a fixed, sorted-or-source
 * order, so two runs over the same `environments/` produce identical output.
 * Idempotent: `--out-dir` is removed and rewritten whole on every real run,
 * never patched in place.
 *
 *   node synthesize-completion-tasks.mjs [options]
 *
 * Options:
 *   --environments-dir <path>     parents to read (default: ../environments)
 *   --out-dir <path>              where children are written (default: ../environments-completion)
 *   --min-lines <n>               skip a function whose body has fewer lines (default: 4)
 *   --max-functions-per-file <n>  skip every candidate from a file with more eligible functions than this (default: 20)
 *   --dry-run                     print what would be written; write nothing; incompatible with --admit
 *   --admit                       after writing, run admit.mjs over --out-dir, delete every child it rejects, and
 *                                 record why in REFUSED.json
 */

import { spawnSync } from 'node:child_process'
import {
  cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BENCH_ROOT = join(HERE, '..')

/** A completion child carries the parent's checks minus any hidden-case one. */
function visibleChecks(parentChecks) {
  return parentChecks.filter(check => check.cases === undefined)
}

/**
 * CLI options, defaulted the way this tool's own header documents them.
 * @param argv - `process.argv.slice(2)`.
 * @returns the parsed options.
 */
function parseArgs(argv) {
  const options = {
    environmentsDir: join(BENCH_ROOT, 'environments'),
    outDir: join(BENCH_ROOT, 'environments-completion'),
    minLines: 4,
    maxFunctionsPerFile: 20,
    dryRun: false,
    admit: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') { options.dryRun = true; continue }
    if (arg === '--admit') { options.admit = true; continue }
    if (arg === '--environments-dir') { options.environmentsDir = resolve(requireValue(argv, ++index, arg)); continue }
    if (arg === '--out-dir') { options.outDir = resolve(requireValue(argv, ++index, arg)); continue }
    if (arg === '--min-lines') { options.minLines = requireInt(argv, ++index, arg); continue }
    if (arg === '--max-functions-per-file') { options.maxFunctionsPerFile = requireInt(argv, ++index, arg); continue }
    throw new Error(`synthesize-completion-tasks: unrecognised argument "${arg}"`)
  }
  if (options.dryRun && options.admit) throw new Error('synthesize-completion-tasks: --dry-run and --admit are mutually exclusive')
  return options
}

function requireValue(argv, index, flag) {
  const value = argv[index]
  if (value === undefined) throw new Error(`synthesize-completion-tasks: ${flag} needs a value`)
  return value
}

function requireInt(argv, index, flag) {
  const value = Number(requireValue(argv, index, flag))
  if (!Number.isInteger(value) || value < 0) throw new Error(`synthesize-completion-tasks: ${flag} needs a non-negative integer`)
  return value
}

// --- Conservative JavaScript scanning -------------------------------------
//
// These three functions cooperate to find where a top-level declaration's
// parameter list and body end, without a real parser: `findMatchingDelimiter`
// walks the source counting `(`/`{`/`[` against their closers, and delegates
// to the other two whenever it meets something whose own delimiters must not
// be counted — a comment, a string, a regex literal, or a template literal
// (whose `${...}` expressions recurse back into `findMatchingDelimiter`).

/** Characters after which a `/` is division, not the start of a regex literal. */
const DIVISION_AFTER = /[\w$)\]]/u

/**
 * The index just past the delimiter matching the opener at `source[openIndex]`
 * (one of `(`, `{`, `[`), tracked as a plain depth count since this bench's
 * reference programs are already well-formed: a stray unmatched bracket
 * inside a string, comment, regex, or template literal is what this function
 * exists to not miscount, not a bracket-type mismatch in real code.
 * @param source - the file text being scanned.
 * @param openIndex - index of the opening `(`, `{`, or `[`.
 * @returns the index just past the matching closer, or -1 when the source ends first.
 */
function findMatchingDelimiter(source, openIndex) {
  let depth = 1
  let i = openIndex + 1
  let lastSignificant = source[openIndex]
  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]
    if (ch === '/' && next === '/') {
      i += 2
      while (i < source.length && source[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1
      i = Math.min(i + 2, source.length)
      continue
    }
    if (ch === '\'' || ch === '"') {
      const quote = ch
      i += 1
      while (i < source.length && source[i] !== quote) i += source[i] === '\\' ? 2 : 1
      i = Math.min(i + 1, source.length)
      lastSignificant = quote
      continue
    }
    if (ch === '`') {
      i = skipTemplateLiteral(source, i)
      lastSignificant = '`'
      continue
    }
    if (ch === '/' && !DIVISION_AFTER.test(lastSignificant)) {
      i = skipRegexLiteral(source, i)
      lastSignificant = '/'
      continue
    }
    if (ch === '(' || ch === '{' || ch === '[') {
      depth += 1
      lastSignificant = ch
      i += 1
      continue
    }
    if (ch === ')' || ch === '}' || ch === ']') {
      depth -= 1
      i += 1
      if (depth === 0) return i
      lastSignificant = ch
      continue
    }
    if (!/\s/u.test(ch)) lastSignificant = ch
    i += 1
  }
  return -1
}

/**
 * The index just past a regex literal's closing flags, given the index of its
 * opening `/`. An unescaped `/` inside a `[...]` character class does not end
 * the literal.
 * @param source - the file text.
 * @param slashIndex - index of the regex literal's opening `/`.
 * @returns the index just past the literal, including its flag letters.
 */
function skipRegexLiteral(source, slashIndex) {
  let i = slashIndex + 1
  let inClass = false
  while (i < source.length && source[i] !== '\n') {
    const ch = source[i]
    if (ch === '\\') { i += 2; continue }
    if (ch === '[') { inClass = true; i += 1; continue }
    if (ch === ']') { inClass = false; i += 1; continue }
    if (ch === '/' && !inClass) { i += 1; break }
    i += 1
  }
  while (i < source.length && /[a-zA-Z]/u.test(source[i])) i += 1
  return i
}

/**
 * The index just past a template literal's closing backtick, given the index
 * of its opening one. Each `${...}` expression recurses through
 * `findMatchingDelimiter`, so nested braces, strings, and template literals
 * inside an expression are scanned by the same rules as the outer program.
 * @param source - the file text.
 * @param backtickIndex - index of the opening backtick.
 * @returns the index just past the closing backtick.
 */
function skipTemplateLiteral(source, backtickIndex) {
  let i = backtickIndex + 1
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\\') { i += 2; continue }
    if (ch === '`') return i + 1
    if (ch === '$' && source[i + 1] === '{') {
      const end = findMatchingDelimiter(source, i + 1)
      i = end === -1 ? source.length : end
      continue
    }
    i += 1
  }
  return i
}

// --- Top-level declaration discovery ---------------------------------------

const FUNCTION_DECL = /^(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gmu
const ARROW_DECL = /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?\(/gmu

/**
 * Every top-level `function name(...) { ... }` or `const name = (...) => { ... }`
 * in `source`, in source order. Only the two literal forms named above count:
 * an arrow whose parameter list is not followed by a brace-delimited body
 * (an expression body, or anything this scanner does not follow to a `{`)
 * is not a function this factory can stub, and is silently excluded.
 * @param source - one reference file's text.
 * @returns each function's name and the body span a stub replaces (the text
 *   strictly between its braces).
 */
function findTopLevelFunctions(source) {
  const found = []
  for (const [pattern, isArrow] of [[FUNCTION_DECL, false], [ARROW_DECL, true]]) {
    for (const match of source.matchAll(pattern)) {
      const name = match[1]
      const parenOpen = match.index + match[0].length - 1
      const parenClose = findMatchingDelimiter(source, parenOpen)
      if (parenClose === -1) continue
      let cursor = parenClose
      if (isArrow) {
        const arrow = /^\s*=>\s*/u.exec(source.slice(cursor))
        if (arrow === null) continue
        cursor += arrow[0].length
      } else {
        cursor += /^\s*/u.exec(source.slice(cursor))[0].length
      }
      if (source[cursor] !== '{') continue
      const braceOpen = cursor
      const braceClose = findMatchingDelimiter(source, braceOpen)
      if (braceClose === -1) continue
      found.push({ name, declStart: match.index, bodyStart: braceOpen + 1, bodyEnd: braceClose - 1 })
    }
  }
  found.sort((left, right) => left.declStart - right.declStart)
  return found
}

/** The number of lines a function's body spans, ignoring the blank margin right inside its braces. */
function bodyLineCount(source, fn) {
  const body = source.slice(fn.bodyStart, fn.bodyEnd).trim()
  return body === '' ? 0 : body.split('\n').length
}

/** `source` with the function at `fn` replaced by a two-line `not implemented` stub; every other line is untouched. */
function applyStub(source, fn) {
  return `${source.slice(0, fn.bodyStart)}\n  throw new Error('not implemented')\n${source.slice(fn.bodyEnd)}`
}

// --- Task authoring ----------------------------------------------------------

/** The paragraph a completion child's prompt adds to its parent's, naming the one function it must complete. */
function completionParagraph(relativeFile, functionName) {
  return 'This task is a completion exercise: every file and function in this workspace already holds its final '
    + `implementation except \`${functionName}\` in \`src/${relativeFile}\`, whose body currently throws `
    + '\'not implemented\'. Implement only that function\'s body so it fulfills the specification above; keep its '
    + 'signature exactly as given, and do not edit any other file, export, or function. This is a visible-test '
    + 'tier: your certificate comes from the suite under test/, not from a held-back corpus.'
}

/**
 * One completion child's `task.json`, in the same key order the bench's own
 * hand-authored ones use. `family` and `completion` are read by
 * `register-completion-environments.ts` (not by `admit.mjs`, which accepts
 * any extra field) and mirror the runtime definition's `detail` exactly, so
 * the registrar needs no re-derivation from the directory name.
 *
 * `id` is derived from `childId` by the same `--` to `--complete-` transform
 * `admit.mjs` and the registrar use, not reassembled from `functionName`
 * alone: a disambiguated `childId` (two files of one parent sharing a
 * function name; see `discoverCandidates`) carries a suffix the bare
 * function name does not, and the id must carry the same suffix or the
 * directory/id consistency check `admit.mjs` runs rejects the child.
 */
function childTaskJson(parentTask, functionName, relativeFile, childId) {
  return {
    id: `code:${childId.replace('--', '--complete-')}`,
    tier: parentTask.tier,
    domain: parentTask.domain,
    family: parentTask.id,
    completion: { file: `src/${relativeFile}`, function: functionName },
    title: `Complete ${functionName} in ${parentTask.title}`,
    prompt: `${parentTask.prompt}\n\n${completionParagraph(relativeFile, functionName)}`,
    heldOut: parentTask.heldOut,
    immutable: parentTask.immutable,
    checks: visibleChecks(parentTask.checks),
  }
}

// --- Filesystem ---------------------------------------------------------------

/** The `.js` files directly under `<parentDir>/reference/src`, sorted; `[]` when there is no such directory. */
function referenceJsFiles(parentDir) {
  const srcDir = join(parentDir, 'reference', 'src')
  if (!existsSync(srcDir)) return []
  return readdirSync(srcDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
    .map(entry => entry.name)
    .sort()
}

/** `<parentDir>/task.json`, parsed and checked against the directory name the way the registrar checks it; `undefined` when absent. */
function readParentTask(parentDir, name) {
  const taskPath = join(parentDir, 'task.json')
  if (!existsSync(taskPath)) return undefined
  const task = JSON.parse(readFileSync(taskPath, 'utf8'))
  if (task.id !== `code:${name}`) throw new Error(`synthesize-completion-tasks: ${name}/task.json declares id ${task.id}`)
  return task
}

/**
 * Writes one completion child at `childDir`: every parent file except `src/`
 * and `task.json` copied through unchanged, `src/` replaced by the reference
 * sources with `fn` stubbed in `relativeFile`, and `task.json` replaced by
 * `taskJson`. `childDir` is removed first, so a rerun is a clean rewrite.
 */
function writeChild(childDir, parentDir, relativeFile, fn, sourceText, taskJson) {
  rmSync(childDir, { recursive: true, force: true })
  mkdirSync(childDir, { recursive: true })
  for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
    if (entry.name === 'src' || entry.name === 'task.json' || entry.name === 'node_modules') continue
    cpSync(join(parentDir, entry.name), join(childDir, entry.name), { recursive: true })
  }
  cpSync(join(parentDir, 'reference', 'src'), join(childDir, 'src'), { recursive: true })
  writeFileSync(join(childDir, 'src', relativeFile), applyStub(sourceText, fn))
  writeFileSync(join(childDir, 'task.json'), `${JSON.stringify(taskJson, null, 2)}\n`)
}

/** `undefined` when `filePath` parses as JavaScript, the first line of `node --check`'s complaint otherwise. */
function syntaxError(filePath) {
  const result = spawnSync(process.execPath, ['--check', filePath], { encoding: 'utf8' })
  if (result.status === 0) return undefined
  return (result.stderr || result.stdout || 'node --check failed').trim().split('\n')[0]
}

// --- Candidate discovery -------------------------------------------------------

/**
 * Every candidate completion child across every parent, before admission.
 * Two files of the same parent that declare a same-named top-level function
 * are disambiguated by appending the file's stem, in file order, so the
 * result stays deterministic without depending on run-to-run map iteration.
 * @param options - the parsed CLI options.
 * @returns the candidates and the counts a report needs.
 */
function discoverCandidates(options) {
  const parentNames = readdirSync(options.environmentsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
  const counts = { parents: 0, parentsWithReference: 0, skippedShort: 0, skippedFileCap: 0 }
  const raw = []
  for (const name of parentNames) {
    const parentDir = join(options.environmentsDir, name)
    const task = readParentTask(parentDir, name)
    if (task === undefined) continue
    counts.parents += 1
    const jsFiles = referenceJsFiles(parentDir)
    if (jsFiles.length === 0) continue
    counts.parentsWithReference += 1
    for (const file of jsFiles) {
      const sourceText = readFileSync(join(parentDir, 'reference', 'src', file), 'utf8')
      const all = findTopLevelFunctions(sourceText)
      const eligible = all.filter(fn => bodyLineCount(sourceText, fn) >= options.minLines)
      counts.skippedShort += all.length - eligible.length
      if (eligible.length > options.maxFunctionsPerFile) {
        counts.skippedFileCap += eligible.length
        continue
      }
      for (const fn of eligible) raw.push({ parent: name, parentDir, task, file, fn, sourceText, naturalId: `${name}--${fn.name}` })
    }
  }
  const byNaturalId = new Map()
  for (const candidate of raw) {
    const list = byNaturalId.get(candidate.naturalId) ?? []
    list.push(candidate)
    byNaturalId.set(candidate.naturalId, list)
  }
  for (const list of byNaturalId.values()) {
    for (const candidate of list) candidate.childId = list.length === 1 ? candidate.naturalId : `${candidate.naturalId}-in-${candidate.file.replace(/\.js$/u, '')}`
  }
  raw.sort((left, right) => left.childId.localeCompare(right.childId))
  return { candidates: raw, counts }
}

// --- Admission ------------------------------------------------------------------

/** Parses one `admit.mjs` run's stdout/stderr into admitted ids and `{ name, reason }` refusals. */
function parseAdmission(result) {
  const admitted = []
  for (const line of result.stdout.split('\n')) {
    const match = /^admit (\S+) /u.exec(line)
    if (match !== null) admitted.push(match[1])
  }
  const refused = []
  for (const line of result.stderr.split('\n')) {
    const match = /^REJECT (\S+): (.+)$/u.exec(line)
    if (match !== null) refused.push({ name: match[1], reason: match[2] })
  }
  return { admitted, refused }
}

/** The reported reason's category, coarse enough to summarize but still naming what admission actually found. */
function reasonCategory(reason) {
  const first = reason.split('; ')[0]
  if (first.startsWith('pre-state passes its tests')) return 'pre-state already passes (the stub is not reached)'
  if (first.startsWith('reference fails its tests')) return 'reference fails its tests'
  if (first.startsWith('task.json lacks')) return 'task.json missing a required field'
  if (first.startsWith('no reference/src')) return 'no reference/src'
  if (first.startsWith('node_modules present')) return 'node_modules present'
  if (first.includes('does not match directory')) return 'id does not match directory'
  return first
}

/**
 * Runs `admit.mjs` over `options.outDir`, deletes every child it rejects, and
 * writes their reasons to `REFUSED.json`, sorted by child directory name.
 * @param options - the parsed CLI options.
 * @param written - every child this run wrote, as `{ childId, tier }`.
 * @returns the admitted children and the refused `{ name, reason }` pairs.
 */
function admitAndPrune(options, written) {
  const result = spawnSync(process.execPath, [join(BENCH_ROOT, 'admit.mjs'), options.outDir], { encoding: 'utf8' })
  const { admitted, refused } = parseAdmission(result)
  for (const { name } of refused) rmSync(join(options.outDir, name), { recursive: true, force: true })
  refused.sort((left, right) => left.name.localeCompare(right.name))
  writeFileSync(
    join(options.outDir, 'REFUSED.json'),
    `${JSON.stringify(refused.map(one => ({ ...one, category: reasonCategory(one.reason) })), null, 2)}\n`,
  )
  const admittedSet = new Set(admitted)
  // admit.mjs's "admit" line names the task id (`code:<parent>--complete-<fn>`),
  // its "REJECT" line the directory (`<parent>--<fn>`); `written` carries both,
  // so admittedTiers matches on `id` and REFUSED.json above matches on `childId`.
  const admittedTiers = written.filter(one => admittedSet.has(one.id)).map(one => one.tier)
  return { admitted, refused, admittedTiers }
}

// --- Reporting --------------------------------------------------------------------

/** Counts `values` into a sorted `{ key: count }` object, for a per-tier or per-reason breakdown. */
function tally(values) {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return Object.fromEntries([...counts.entries()].sort((left, right) => (left[0] > right[0] ? 1 : -1)))
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!existsSync(options.environmentsDir)) throw new Error(`synthesize-completion-tasks: no environments directory at ${options.environmentsDir}`)
  const { candidates, counts } = discoverCandidates(options)

  if (options.dryRun) {
    for (const candidate of candidates) console.log(`would write ${candidate.childId}`)
    console.log(`parents: ${counts.parents}, with reference: ${counts.parentsWithReference}, candidates: ${candidates.length}`)
    console.log(`skipped (too short): ${counts.skippedShort}, skipped (file over cap): ${counts.skippedFileCap}`)
    return
  }

  rmSync(options.outDir, { recursive: true, force: true })
  mkdirSync(options.outDir, { recursive: true })
  const written = []
  let droppedSyntax = 0
  for (const candidate of candidates) {
    const taskJson = childTaskJson(candidate.task, candidate.fn.name, candidate.file, candidate.childId)
    const childDir = join(options.outDir, candidate.childId)
    writeChild(childDir, candidate.parentDir, candidate.file, candidate.fn, candidate.sourceText, taskJson)
    const stubProblem = syntaxError(join(childDir, 'src', candidate.file))
    if (stubProblem !== undefined) {
      rmSync(childDir, { recursive: true, force: true })
      droppedSyntax += 1
      console.error(`drop ${candidate.childId}: stub does not parse: ${stubProblem}`)
      continue
    }
    written.push({ childId: candidate.childId, id: taskJson.id, tier: candidate.task.tier })
  }

  console.log(`parents: ${counts.parents}, with reference: ${counts.parentsWithReference}, candidates: ${candidates.length}`)
  console.log(`skipped (too short): ${counts.skippedShort}, skipped (file over cap): ${counts.skippedFileCap}, dropped (stub did not parse): ${droppedSyntax}`)
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
