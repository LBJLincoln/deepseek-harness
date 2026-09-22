#!/usr/bin/env node
// Plants N synthetic defect instances from the mutation catalogue
// (seed-catalogue.json) into a copy of a target repository, for seeded-defect
// (canary) recall estimation on a codebase with no documented ground truth:
// data/code-safety/README.md#recall-without-a-ground-truth-seeded-defects owns
// the method. The original target is never modified; every mutation lands in
// <out dir>/repo, a full copy. A catalogue entry names a CWE, a language, a
// regex that finds a candidate line (`sitePattern`, plus optional
// `fileRequirePattern`/`fileExcludePattern` tested against the whole file and
// `fieldHintPattern` tested against a captured `req.*` field name), and a
// string template (`insertTemplate`) that becomes one new line placed
// immediately after the matched line. `{{indent}}` is the matched line's
// leading whitespace, `{{source}}`/`{{field}}` are the matched
// `req.<source>.<field>` (absent for the credential entry, which matches a
// bare `require(...)` line instead), `{{line}}` is the matched line's 1-based
// number (for unique identifier names), and `{{hex}}` is a 32-character hex
// string derived from the seed and the site (the hardcoded-credential entry
// only). Site detection is regex-level, not a parser; a lightweight per-line
// scan skips `//` comments, `/* */` bodies, and multi-line template literals so an
// insertion never lands inside one. Every inserted line is validated with
// `node --check` immediately after insertion; a site whose file fails the
// check is undone and does not count toward N. No two accepted sites in the
// same file are ever within 10 lines of each other.
//
// Selection order is a seeded Fisher-Yates shuffle of every candidate site
// (from every entry, across every eligible file), read in two passes: sites
// whose field matches their entry's `fieldHintPattern` first (or that declare
// no hint), then the rest — so seeding prefers a realistic field name (a
// `url`-ish field for the redirect entry, say) without ever blocking N when
// only a plain field is available. The same seed and the same target always
// produce the same planted set; a different seed reshuffles it.
//
// Usage:
//   node seed-defects.mjs <target dir> <out dir> --seed <seed> --n <count>
//     [--language javascript] [--catalogue <path>] [--avoid <ground-truth.json>]...
//   node seed-defects.mjs <target dir> --dry-run [--seed <seed> --n <count>]
//     [--language javascript] [--catalogue <path>] [--avoid <ground-truth.json>]... [--json]
//
// A real run writes <out dir>/repo (the mutated copy), <out
// dir>/seeded.ground-truth.json (same fields as targets/nodegoat.ground-truth.json:
// id, category, cwe, file, lines; no `alsoAt`, since a planted defect has one
// definite location), and <out dir>/seed-manifest.json (seed, catalogue
// digest, sites considered, sites planted, per-entry counts, rejections).
// Both live beside `repo/`, never inside it, so the review the estimate scores
// is never pointed at its own answer key. `--dry-run` scans the target in
// place (never copies or writes) and lists every candidate site; with `--seed`
// and `--n` it also marks which ones that seed would plant.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_CATALOGUE_PATH = resolve(import.meta.dirname, 'seed-catalogue.json')
/** No two planted sites in one file may be this close together, in lines, or closer. */
const MIN_LINE_SEPARATION = 10
/** Directories a review would not read as the target's own application source. */
const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.git', 'test', 'tests', 'spec', 'vendor', 'dist', 'build', 'coverage', '.next', '.nuxt'])
/** Well-known build-tool configuration filenames, not application source that processes requests. */
const EXCLUDED_FILE_NAMES = new Set(['Gruntfile.js', 'gulpfile.js', 'webpack.config.js', 'rollup.config.js', 'karma.conf.js', 'jest.config.js', 'babel.config.js', '.eslintrc.js'])
/** File extension scanned per supported `--language`. */
const EXTENSION_BY_LANGUAGE = { javascript: '.js' }

/**
 * Parses the command line.
 * @param {string[]} argv arguments after the script path
 * @returns {{ targetDir: string, outDir: string | undefined, language: string, seed: string | undefined, n: number | undefined, cataloguePath: string, avoidPaths: string[], maxPerEntry: number, dryRun: boolean, json: boolean }}
 */
export function parseArgs(argv) {
  const positional = []
  const avoidPaths = []
  let language = 'javascript'
  let seed
  let n
  let cataloguePath = DEFAULT_CATALOGUE_PATH
  let maxPerEntry = Infinity
  let dryRun = false
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--language') language = argv[++i]
    else if (arg === '--seed') seed = argv[++i]
    else if (arg === '--n') n = Number(argv[++i])
    else if (arg === '--catalogue') cataloguePath = resolve(argv[++i])
    else if (arg === '--avoid') avoidPaths.push(resolve(argv[++i]))
    else if (arg === '--max-per-entry') maxPerEntry = Number(argv[++i])
    else if (arg === '--dry-run') dryRun = true
    else if (arg === '--json') json = true
    else positional.push(arg)
  }
  const [targetDir, outDir] = positional
  if (targetDir === undefined) {
    throw new Error('usage: node seed-defects.mjs <target dir> <out dir> --seed <seed> --n <count> [--language javascript] [--catalogue <path>] [--avoid <ground-truth.json>]... [--max-per-entry <count>] ; or --dry-run in place of <out dir> --seed --n')
  }
  if (!dryRun && outDir === undefined) throw new Error('an out dir is required unless --dry-run')
  if (!dryRun && seed === undefined) throw new Error('--seed is required unless --dry-run')
  if (!dryRun && (n === undefined || !Number.isInteger(n) || n <= 0)) throw new Error('--n must be a positive integer unless --dry-run')
  if (maxPerEntry !== Infinity && (!Number.isInteger(maxPerEntry) || maxPerEntry <= 0)) throw new Error('--max-per-entry must be a positive integer')
  return { targetDir: resolve(targetDir), outDir: outDir === undefined ? undefined : resolve(outDir), language, seed, n, cataloguePath, avoidPaths, maxPerEntry, dryRun, json }
}

/**
 * Loads and validates the mutation catalogue.
 * @param {string} path the catalogue JSON file
 * @returns {{ raw: string, entries: object[] }} the parsed entries and the file's raw text (for digesting)
 */
export function loadCatalogue(path) {
  const raw = readFileSync(path, 'utf8')
  const parsed = JSON.parse(raw)
  const seen = new Set()
  for (const entry of parsed.entries ?? []) {
    for (const field of ['id', 'cwe', 'category', 'language', 'sitePattern', 'insertTemplate']) {
      if (typeof entry[field] !== 'string' || entry[field] === '') throw new Error(`${path}: entry missing required string field "${field}": ${JSON.stringify(entry)}`)
    }
    if (seen.has(entry.id)) throw new Error(`${path}: duplicate entry id "${entry.id}"`)
    seen.add(entry.id)
  }
  return { raw, entries: parsed.entries ?? [] }
}

/**
 * Deterministic 0..1 pseudo-random generator seeded from an arbitrary string
 * (mulberry32, seeded via the first 32 bits of the seed's SHA-256).
 * @param {string} seed any string
 * @returns {() => number} a function returning the next pseudo-random value in [0, 1)
 */
export function makeRng(seed) {
  let state = createHash('sha256').update(String(seed)).digest().readUInt32LE(0) >>> 0
  return function rng() {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Fisher-Yates shuffle using a seeded generator.
 * @param {T[]} items the items to shuffle
 * @param {() => number} rng a `makeRng` generator
 * @returns {T[]} a new, shuffled array
 * @template T
 */
export function seededShuffle(items, rng) {
  const copy = items.slice()
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/**
 * Lists files under a directory with the given extension, skipping
 * `EXCLUDED_DIR_NAMES`, `EXCLUDED_FILE_NAMES`, and `*.min<extension>` files.
 * @param {string} rootDir the directory to walk
 * @param {string} extension file extension to keep, with its leading dot
 * @returns {string[]} absolute paths, sorted
 */
export function listSourceFiles(rootDir, extension) {
  const results = []
  const walk = dir => {
    for (const name of readdirSync(dir).sort()) {
      if (EXCLUDED_DIR_NAMES.has(name) || EXCLUDED_FILE_NAMES.has(name)) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name.endsWith(extension) && !name.endsWith(`.min${extension}`)) results.push(full)
    }
  }
  walk(rootDir)
  return results
}

/**
 * Classifies each line of a file as safe or unsafe to insert a new statement
 * after: unsafe inside a `//` line comment, an unclosed `/* *\/` block
 * comment, or a multi-line template literal carried in from an earlier line.
 * Regex-level, not a parser: a backtick or `/*` inside an ordinary string can
 * misclassify a line, which `node --check` catches after the fact.
 * @param {string} text the file's content
 * @returns {boolean[]} one entry per line
 */
export function safeLinesOf(text) {
  const lines = text.split('\n')
  const safe = new Array(lines.length)
  let inBlockComment = false
  let inTemplate = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    safe[i] = !inBlockComment && !inTemplate && !/^\s*\/\//.test(line)
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false
    } else {
      const openAt = line.indexOf('/*')
      if (openAt !== -1) inBlockComment = !line.slice(openAt).includes('*/')
    }
    const backticks = (line.match(/`/g) ?? []).length
    if (backticks % 2 === 1) inTemplate = !inTemplate
  }
  return safe
}

/**
 * Loads a set of `file:line` strings to keep candidate sites away from,
 * expanded by `tolerance` lines on each side, from ground-truth files in
 * `compare.mjs`'s issue format. Keeps a planted defect from landing on top of
 * a target's own documented, real issues.
 * @param {string[]} paths ground-truth JSON files
 * @param {number} tolerance lines of margin on each side of a listed location
 * @returns {Set<string>} `relative/file.js:lineNumber` entries to avoid
 */
export function loadAvoidSet(paths, tolerance) {
  const avoid = new Set()
  for (const path of paths) {
    const truth = JSON.parse(readFileSync(path, 'utf8'))
    for (const issue of truth.issues ?? []) {
      for (const location of [{ file: issue.file, lines: issue.lines }, ...(issue.alsoAt ?? [])]) {
        for (let line = location.lines[0] - tolerance; line <= location.lines[1] + tolerance; line++) avoid.add(`${location.file}:${line}`)
      }
    }
  }
  return avoid
}

/**
 * The indentation a line inserted directly after `line` should use: one
 * level deeper than `line` itself when `line` opens a block or argument list
 * (ends with `{`, `(`, or `[`), so the inserted statement reads as part of
 * that body rather than as a sibling of the line it follows.
 * @param {string} line the matched site line
 * @returns {string} leading whitespace for the line to be inserted after it
 */
function indentForInsertionAfter(line) {
  const leading = /^\s*/.exec(line)[0]
  return /[{([]\s*$/.test(line.trimEnd()) ? `${leading}    ` : leading
}

/**
 * Finds every candidate insertion site for a set of catalogue entries across
 * a source tree.
 * @param {string} rootDir the tree to scan (a target checkout, or its copy)
 * @param {object[]} entries catalogue entries already filtered to one language
 * @param {string} extension the language's file extension
 * @param {Set<string>} avoidSet `file:line` locations to skip, from `loadAvoidSet`
 * @returns {Array<{ entryId: string, file: string, absPath: string, lineIndex: number, indent: string, source: string | undefined, field: string | undefined, hinted: boolean }>} every candidate, in scan order
 */
export function findCandidates(rootDir, entries, extension, avoidSet) {
  const candidates = []
  for (const absPath of listSourceFiles(rootDir, extension)) {
    const relPath = relative(rootDir, absPath)
    const text = readFileSync(absPath, 'utf8')
    const lines = text.split('\n')
    const safe = safeLinesOf(text)
    for (const entry of entries) {
      if (entry.fileRequirePattern && !new RegExp(entry.fileRequirePattern).test(text)) continue
      if (entry.fileExcludePattern && new RegExp(entry.fileExcludePattern).test(text)) continue
      const siteRe = new RegExp(entry.sitePattern)
      const hintRe = entry.fieldHintPattern ? new RegExp(entry.fieldHintPattern, 'i') : null
      for (let i = 0; i < lines.length; i++) {
        if (!safe[i] || avoidSet.has(`${relPath}:${i + 1}`)) continue
        const match = siteRe.exec(lines[i])
        if (!match) continue
        const [, source, field] = match
        candidates.push({
          entryId: entry.id,
          file: relPath,
          absPath,
          lineIndex: i,
          indent: indentForInsertionAfter(lines[i]),
          source,
          field,
          hinted: hintRe === null || (field !== undefined && hintRe.test(field)),
        })
      }
    }
  }
  return candidates
}

/**
 * Fills a catalogue entry's `insertTemplate` for one matched site.
 * @param {string} template the entry's `insertTemplate`
 * @param {{ indent: string, source?: string, field?: string, line: string, hex: string }} vars substitution values
 * @returns {string} the line to insert, with no trailing newline
 */
export function fillTemplate(template, vars) {
  return template.replaceAll(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = vars[key]
    if (value === undefined) throw new Error(`insertTemplate references {{${key}}}, which this site has no value for`)
    return value
  })
}

/**
 * Rebuilds a file's text with one inserted line per accepted site.
 * @param {string} originalText the file's untouched content
 * @param {number[]} lineIndices accepted sites' original 0-based line indices, any order
 * @param {Map<number, object>} siteByLineIndex each index's candidate (from `findCandidates`)
 * @param {Map<string, object>} entryById catalogue entries by id
 * @param {(site: object) => string} hexFor deterministic 32-hex-character generator for a site
 * @returns {{ text: string, finalLineByIndex: Map<number, number> }} the rebuilt text and each site's final 1-based line number
 */
export function applyInsertions(originalText, lineIndices, siteByLineIndex, entryById, hexFor) {
  const lines = originalText.split('\n')
  const finalLineByIndex = new Map()
  const ascending = lineIndices.slice().sort((a, b) => a - b)
  let insertedSoFar = 0
  for (const lineIndex of ascending) {
    const site = siteByLineIndex.get(lineIndex)
    const entry = entryById.get(site.entryId)
    const insertedLine = fillTemplate(entry.insertTemplate, {
      indent: site.indent,
      source: site.source,
      field: site.field,
      line: String(lineIndex + 1),
      hex: hexFor(site),
    })
    const insertAt = lineIndex + 1 + insertedSoFar
    lines.splice(insertAt, 0, insertedLine)
    finalLineByIndex.set(lineIndex, insertAt + 1)
    insertedSoFar += 1
  }
  return { text: lines.join('\n'), finalLineByIndex }
}

/**
 * Whether a file parses as valid JavaScript, via `node --check`.
 * @param {string} absPath the file to check
 * @returns {boolean} true when the file parses
 */
function checkSyntax(absPath) {
  try {
    execFileSync(process.execPath, ['--check', absPath], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Orders candidates for selection: a seeded Fisher-Yates shuffle, then sites
 * whose field matches their entry's `fieldHintPattern` (or that declare none)
 * ahead of the rest. Shared by the real selector and the `--dry-run`
 * simulation so both walk candidates in the same order for the same seed.
 * @param {object[]} candidates every candidate, from `findCandidates`
 * @param {string} seed the run's seed
 * @returns {object[]} candidates in selection order
 */
export function orderCandidates(candidates, seed) {
  const shuffled = seededShuffle(candidates, makeRng(seed))
  return [...shuffled.filter(c => c.hinted), ...shuffled.filter(c => !c.hinted)]
}

/**
 * Whether a candidate line is within `MIN_LINE_SEPARATION` of an already-accepted line in the same file.
 * @param {number[]} acceptedLines already-accepted 0-based line indices in this candidate's file
 * @param {number} lineIndex the candidate's 0-based line index
 * @returns {boolean} true when the candidate is too close to accept
 */
function tooCloseToAccepted(acceptedLines, lineIndex) {
  return acceptedLines.some(line => Math.abs(line - lineIndex) <= MIN_LINE_SEPARATION)
}

/**
 * Selects sites in seeded order and plants them, validating and undoing a
 * site whose file fails to parse after it lands.
 * @param {object[]} candidates every candidate, from `findCandidates`
 * @param {object[]} entries catalogue entries by id, already filtered to one language
 * @param {string} seed the run's seed
 * @param {number} n how many sites to plant
 * @param {number} [maxPerEntry] the most sites any one catalogue entry may contribute; default unlimited. Spreads a small N across classes instead of letting the entry with the most candidates dominate.
 * @returns {{ planted: object[], rejectedBySeparation: number, rejectedByCheck: number }} the accepted sites (with `finalLine`) and rejection counts
 */
export function selectAndPlant(candidates, entries, seed, n, maxPerEntry = Infinity) {
  const entryById = new Map(entries.map(entry => [entry.id, entry]))
  const ordered = orderCandidates(candidates, seed)
  const hexFor = site => createHash('sha256').update(`${seed}:${site.file}:${site.lineIndex}`).digest('hex').slice(0, 32)

  const acceptedLinesByFile = new Map()
  const siteByLineIndexByFile = new Map()
  const originalTextByFile = new Map()
  const countByEntry = new Map()
  const planted = []
  let rejectedBySeparation = 0
  let rejectedByCheck = 0

  for (const candidate of ordered) {
    if (planted.length >= n) break
    if ((countByEntry.get(candidate.entryId) ?? 0) >= maxPerEntry) continue
    const acceptedLines = acceptedLinesByFile.get(candidate.file) ?? []
    if (tooCloseToAccepted(acceptedLines, candidate.lineIndex)) {
      rejectedBySeparation += 1
      continue
    }
    if (!originalTextByFile.has(candidate.file)) originalTextByFile.set(candidate.file, readFileSync(candidate.absPath, 'utf8'))
    const originalText = originalTextByFile.get(candidate.file)
    const siteByLineIndex = siteByLineIndexByFile.get(candidate.file) ?? new Map()
    siteByLineIndex.set(candidate.lineIndex, candidate)
    const tentativeLines = [...acceptedLines, candidate.lineIndex]

    const { text, finalLineByIndex } = applyInsertions(originalText, tentativeLines, siteByLineIndex, entryById, hexFor)
    writeFileSync(candidate.absPath, text)
    if (checkSyntax(candidate.absPath)) {
      acceptedLinesByFile.set(candidate.file, tentativeLines)
      siteByLineIndexByFile.set(candidate.file, siteByLineIndex)
      countByEntry.set(candidate.entryId, (countByEntry.get(candidate.entryId) ?? 0) + 1)
      planted.push({ ...candidate, finalLine: finalLineByIndex.get(candidate.lineIndex) })
    } else {
      siteByLineIndex.delete(candidate.lineIndex)
      const reverted = applyInsertions(originalText, acceptedLines, siteByLineIndex, entryById, hexFor)
      writeFileSync(candidate.absPath, reverted.text)
      rejectedByCheck += 1
    }
  }
  return { planted, rejectedBySeparation, rejectedByCheck }
}

/**
 * Runs one seeding: copies the target, plants up to N sites, and writes the
 * ground truth and manifest beside the copy.
 * @param {{ targetDir: string, outDir: string, language: string, seed: string, n: number, cataloguePath: string, avoidPaths: string[], maxPerEntry?: number }} options parsed run options
 * @returns {{ repoDir: string, groundTruthPath: string, manifestPath: string, planted: number, requested: number }} where everything landed and how many sites were planted
 */
export function seedDefects(options) {
  const { targetDir, outDir, language, seed, n, cataloguePath, avoidPaths, maxPerEntry = Infinity } = options
  if (existsSync(outDir)) throw new Error(`${outDir} already exists; seed-defects.mjs never overwrites an out dir`)
  const extension = EXTENSION_BY_LANGUAGE[language]
  if (extension === undefined) throw new Error(`no source extension configured for language "${language}" (known: ${Object.keys(EXTENSION_BY_LANGUAGE).join(', ')})`)
  const { raw: catalogueRaw, entries: allEntries } = loadCatalogue(cataloguePath)
  const entries = allEntries.filter(entry => entry.language === language)
  if (entries.length === 0) throw new Error(`${cataloguePath} has no entries for language "${language}"`)

  const repoDir = join(outDir, 'repo')
  mkdirSync(outDir, { recursive: true })
  cpSync(targetDir, repoDir, { recursive: true })

  const avoidSet = loadAvoidSet(avoidPaths, 3)
  const candidates = findCandidates(repoDir, entries, extension, avoidSet)
  const { planted, rejectedBySeparation, rejectedByCheck } = selectAndPlant(candidates, entries, seed, n, maxPerEntry)
  if (planted.length < n) {
    throw new Error(`only ${planted.length} of the requested ${n} sites could be planted (${candidates.length} candidates considered, ${rejectedBySeparation} too close to another accepted site, ${rejectedByCheck} undone after failing node --check, ${maxPerEntry === Infinity ? 'no' : maxPerEntry}-per-entry cap); widen the catalogue, raise --max-per-entry, or lower --n`)
  }

  const entryById = new Map(entries.map(entry => [entry.id, entry]))
  const revision = gitRevision(targetDir)
  const orderedSites = planted.slice().sort((a, b) => a.file.localeCompare(b.file) || a.finalLine - b.finalLine)
  const issues = orderedSites.map((site, index) => ({
    id: `SEED-${String(index + 1).padStart(3, '0')}`,
    category: entryById.get(site.entryId).category,
    cwe: entryById.get(site.entryId).cwe,
    file: site.file,
    lines: [site.finalLine, site.finalLine],
    description: `Planted by seed-defects.mjs, catalogue entry "${site.entryId}", seed "${seed}".`,
  }))
  const groundTruth = {
    target: basename(targetDir),
    repository: targetDir,
    revision,
    source: 'Synthetic defects planted by data/code-safety/tools/seed-defects.mjs from data/code-safety/tools/seed-catalogue.json, for seeded-recall estimation. Not real, naturally occurring issues; see data/code-safety/README.md#recall-without-a-ground-truth-seeded-defects.',
    issues,
  }
  const groundTruthPath = join(outDir, 'seeded.ground-truth.json')
  writeFileSync(groundTruthPath, `${JSON.stringify(groundTruth, null, 2)}\n`)

  const perEntryCounts = Object.fromEntries(entries.map(entry => [entry.id, planted.filter(site => site.entryId === entry.id).length]))
  const manifest = {
    generatedAt: new Date().toISOString(),
    seed,
    language,
    catalogueDigest: createHash('sha256').update(catalogueRaw).digest('hex'),
    cataloguePath: relative(process.cwd(), cataloguePath) || cataloguePath,
    targetDir,
    targetRevision: revision,
    outDir,
    requested: n,
    planted: planted.length,
    sitesConsidered: candidates.length,
    rejectedBySeparation,
    rejectedByCheck,
    perEntryCounts,
    sites: issues.map((issue, index) => ({ id: issue.id, entryId: orderedSites[index].entryId, file: issue.file, line: issue.lines[0] })),
  }
  const manifestPath = join(outDir, 'seed-manifest.json')
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  return { repoDir, groundTruthPath, manifestPath, planted: planted.length, requested: n }
}

/**
 * The target's git HEAD, or `"unknown"` when it is not a git checkout.
 * @param {string} targetDir the target directory
 * @returns {string} a full SHA, or `"unknown"`
 */
function gitRevision(targetDir) {
  try {
    return execFileSync('git', ['-C', targetDir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return 'unknown'
  }
}

/**
 * Lists every candidate site without copying or writing anything, for
 * `--dry-run`. With a seed and count, also marks which sites that seed would plant.
 * @param {{ targetDir: string, language: string, cataloguePath: string, avoidPaths: string[], seed: string | undefined, n: number | undefined, maxPerEntry: number }} options parsed run options
 * @returns {{ candidates: object[], selected: Set<number> }} every candidate (in scan order) and the indices selection would plant
 */
function dryRun(options) {
  const { targetDir, language, cataloguePath, avoidPaths, seed, n, maxPerEntry } = options
  const extension = EXTENSION_BY_LANGUAGE[language]
  if (extension === undefined) throw new Error(`no source extension configured for language "${language}" (known: ${Object.keys(EXTENSION_BY_LANGUAGE).join(', ')})`)
  const { entries: allEntries } = loadCatalogue(cataloguePath)
  const entries = allEntries.filter(entry => entry.language === language)
  const avoidSet = loadAvoidSet(avoidPaths, 3)
  const candidates = findCandidates(targetDir, entries, extension, avoidSet)
  const selected = new Set()
  if (seed !== undefined && n !== undefined) {
    // A dry run never writes, so selection is simulated on line numbers alone
    // (no node --check, no actual insertion) — an approximation of the real
    // run's acceptance, useful for judging whether N is reachable.
    const ordered = orderCandidates(candidates, seed)
    const acceptedLinesByFile = new Map()
    const countByEntry = new Map()
    for (const candidate of ordered) {
      if (selected.size >= n) break
      if ((countByEntry.get(candidate.entryId) ?? 0) >= maxPerEntry) continue
      const acceptedLines = acceptedLinesByFile.get(candidate.file) ?? []
      if (tooCloseToAccepted(acceptedLines, candidate.lineIndex)) continue
      acceptedLinesByFile.set(candidate.file, [...acceptedLines, candidate.lineIndex])
      countByEntry.set(candidate.entryId, (countByEntry.get(candidate.entryId) ?? 0) + 1)
      selected.add(candidates.indexOf(candidate))
    }
  }
  return { candidates, selected }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.dryRun) {
    const { candidates, selected } = dryRun(options)
    if (options.json) {
      console.log(JSON.stringify(candidates.map((c, i) => ({ ...c, absPath: undefined, selected: selected.has(i) })), null, 2))
      return
    }
    for (const [i, c] of candidates.entries()) {
      const marker = selected.has(i) ? '[SELECTED]' : '          '
      console.log(`${marker} ${c.file}:${c.lineIndex + 1} ${c.entryId}${c.field ? ` (req.${c.source}.${c.field})` : ''}${c.hinted ? '' : ' [unhinted]'}`)
    }
    console.log(`${candidates.length} candidate sites${options.seed !== undefined ? `; ${selected.size} of ${options.n} requested would be planted under seed ${JSON.stringify(options.seed)}` : ''}`)
    return
  }
  const result = seedDefects(options)
  console.log(`planted ${result.planted}/${result.requested} defects into ${result.repoDir}; ground truth ${result.groundTruthPath}; manifest ${result.manifestPath}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main()
