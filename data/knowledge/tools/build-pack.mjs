#!/usr/bin/env node
/**
 * Build one knowledge pack from the research sweeps that feed it.
 *
 *   node data/knowledge/tools/build-pack.mjs <pack-dir> [--sweeps <dir>] [--check]
 *
 * `<pack-dir>` holds `pack.json` (identity, window, sources, themes with their
 * keywords and kinds) and `skills/<theme>/SKILL.md`, the authored body of every
 * theme. With `--sweeps <dir>`, the tool merges `<dir>/<source>/items.json` for
 * every source the pack names into `corpus/items.json`, deduplicated by URL with
 * the union of tags and the list of sources that reported the item, and copies
 * `<dir>/<source>/report.md` to `corpus/<source>-report.md`. It then renders
 * `skills/<theme>/references/items.md` from the corpus by each theme's keywords
 * and kinds, validates every `SKILL.md` frontmatter, and writes `manifest.json`
 * with every file's size and SHA-256. `--check` renders in memory and exits 1
 * when any rendered file or the manifest differs from disk, so a stale pack is
 * a gate failure rather than a silent drift.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, posix, relative, resolve, sep } from 'node:path'

const REQUIRED_STRINGS = ['id', 'kind', 'name', 'date', 'url', 'summary', 'adopt', 'evidence']
const KINDS = new Set(['model', 'dataset', 'paper', 'repo', 'release', 'environment-hub', 'framework', 'benchmark', 'policy'])
const ROLES = new Set(['threat', 'input', 'baseline'])
const EVIDENCE = new Set(['primary', 'secondary', 'claim'])
const DATE = /^\d{4}-\d{2}-\d{2}$/
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DESCRIPTION_MAX = 500

function usage(message) {
  console.error(`build-pack: ${message}`)
  console.error('usage: node data/knowledge/tools/build-pack.mjs <pack-dir> [--sweeps <dir>] [--check]')
  process.exit(2)
}

function parseArgs(argv) {
  const request = { packDir: undefined, sweeps: undefined, check: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--sweeps') {
      request.sweeps = argv[index + 1]
      if (request.sweeps === undefined) usage('--sweeps needs a directory')
      index += 1
    } else if (arg === '--check') {
      request.check = true
    } else if (arg.startsWith('--')) {
      usage(`unknown option ${arg}`)
    } else if (request.packDir === undefined) {
      request.packDir = arg
    } else {
      usage(`unexpected argument ${arg}`)
    }
  }
  if (request.packDir === undefined) usage('missing <pack-dir>')
  if (request.check && request.sweeps !== undefined) usage('--check reads the corpus on disk; drop --sweeps')
  return request
}

const sha256 = content => createHash('sha256').update(content).digest('hex')
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const toPosix = path => path.split(sep).join(posix.sep)

/** Reject one sweep item that does not satisfy the corpus record. */
function validateItem(item, where) {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error(`${where}: not an object`)
  for (const field of REQUIRED_STRINGS) {
    if (typeof item[field] !== 'string' || item[field].trim() === '') throw new Error(`${where}: "${field}" must be a non-empty string`)
  }
  if (!KINDS.has(item.kind)) throw new Error(`${where}: kind "${item.kind}" is not one of ${[...KINDS].join(', ')}`)
  if (!DATE.test(item.date)) throw new Error(`${where}: date "${item.date}" is not YYYY-MM-DD`)
  if (!EVIDENCE.has(item.evidence)) throw new Error(`${where}: evidence "${item.evidence}" is not primary, secondary, or claim`)
  const relevance = item.relevance
  if (typeof relevance !== 'object' || relevance === null) throw new Error(`${where}: relevance must be an object`)
  if (!Array.isArray(relevance.goals) || relevance.goals.some(goal => ![1, 2, 3, 4].includes(goal))) throw new Error(`${where}: relevance.goals must list goals 1 to 4`)
  if (!Array.isArray(relevance.seams) || relevance.seams.some(seam => typeof seam !== 'string')) throw new Error(`${where}: relevance.seams must be strings`)
  if (!ROLES.has(relevance.role)) throw new Error(`${where}: relevance.role "${relevance.role}" is not threat, input, or baseline`)
  if (!Array.isArray(item.tags) || item.tags.some(tag => typeof tag !== 'string')) throw new Error(`${where}: tags must be strings`)
}

/** One key per distinct resource: scheme, host prefix, trailing slash, and arXiv version dropped. */
function urlKey(url) {
  let key = url.trim().toLowerCase().replace(/^http:\/\//, 'https://').replace(/^https:\/\/www\./, 'https://').replace(/\/+$/, '')
  key = key.replace(/(arxiv\.org\/(?:abs|pdf)\/\d{4}\.\d{4,5})v\d+$/, '$1').replace(/\.pdf$/, '')
  return key
}

const normalizeTag = tag => tag.trim().toLowerCase().replace(/[\s_]+/g, '-')

/** Merge every source's items into one corpus, first report wins, tags and sources accumulate. */
function mergeSweeps(pack, sweepsDir) {
  const byKey = new Map()
  const reports = new Map()
  for (const source of pack.sources) {
    const itemsPath = join(sweepsDir, source, 'items.json')
    if (!existsSync(itemsPath)) throw new Error(`sweep ${source} has no items.json at ${itemsPath}`)
    const items = readJson(itemsPath)
    if (!Array.isArray(items)) throw new Error(`${itemsPath}: expected an array`)
    items.forEach((item, index) => {
      const where = `${source}/items.json[${index}]`
      validateItem(item, where)
      const key = urlKey(item.url)
      const tags = [...new Set(item.tags.map(normalizeTag))].sort()
      const existing = byKey.get(key)
      if (existing === undefined) {
        const id = item.id.startsWith(`${source}-`) ? item.id : `${source}-${item.id}`
        byKey.set(key, { ...item, id, tags, relevance: { ...item.relevance, seams: [...item.relevance.seams].sort() }, source, sources: [source] })
      } else {
        existing.tags = [...new Set([...existing.tags, ...tags])].sort()
        existing.relevance.goals = [...new Set([...existing.relevance.goals, ...item.relevance.goals])].sort()
        existing.relevance.seams = [...new Set([...existing.relevance.seams, ...item.relevance.seams])].sort()
        if (!existing.sources.includes(source)) existing.sources.push(source)
      }
    })
    const reportPath = join(sweepsDir, source, 'report.md')
    if (!existsSync(reportPath)) throw new Error(`sweep ${source} has no report.md at ${reportPath}`)
    // Trailing whitespace is stripped so the copied briefing passes the repository's whitespace gate unchanged in meaning.
    reports.set(source, readFileSync(reportPath, 'utf8').replace(/[ \t]+$/gm, ''))
  }
  const items = [...byKey.values()].sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name))
  const ids = new Set()
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`duplicate item id ${item.id} after merge`)
    ids.add(item.id)
  }
  return { items, reports }
}

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whether one corpus item belongs to one theme: by kind, by tag, or by a whole-word keyword in its name or summary. */
function matchesTheme(item, theme) {
  if (theme.kinds.includes(item.kind)) return true
  if (item.tags.some(tag => theme.keywords.includes(tag))) return true
  const text = `${item.name} ${item.summary}`.toLowerCase()
  return theme.keywords.some(keyword => new RegExp(`(?<![a-z0-9])${escapeRegExp(keyword)}(?![a-z0-9])`).test(text))
}

const cell = text => String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

/** The generated companion of one theme skill: a table and one entry per item. */
function renderReferences(pack, theme, items) {
  const lines = [
    `# ${theme.title}: items, ${pack.window.from} to ${pack.window.to}`,
    '',
    'Generated by `data/knowledge/tools/build-pack.mjs` from `../../../corpus/items.json`; edit the corpus or the pack, never this file.',
    '',
    `${items.length} item(s) match this theme by kind (${theme.kinds.join(', ') || 'none'}) or keyword (${theme.keywords.join(', ')}).`,
    '',
    '| Date | Name | Kind | Role | Evidence | Goals | Sources |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const item of items) {
    lines.push(`| ${item.date} | [${cell(item.name)}](${item.url}) | ${item.kind} | ${item.relevance.role} | ${item.evidence} | ${item.relevance.goals.join(', ')} | ${item.sources.join(', ')} |`)
  }
  lines.push('', '## Items', '')
  for (const item of items) {
    lines.push(`### ${item.name}`, '')
    lines.push(`- Date ${item.date} · kind ${item.kind} · role ${item.relevance.role} · evidence ${item.evidence} · goals ${item.relevance.goals.join(', ')}${item.relevance.seams.length > 0 ? ` · seams ${item.relevance.seams.join(', ')}` : ''}`)
    lines.push(`- URL: <${item.url}>`)
    lines.push(`- Summary: ${item.summary.trim()}`)
    lines.push(`- Adopt: ${item.adopt.trim()}`)
    if (item.tags.length > 0) lines.push(`- Tags: ${item.tags.join(', ')}`)
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

/** Frontmatter of one SKILL.md as the provider reads it: a `---` block of `key: value` lines. */
function parseFrontmatter(text, where) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)
  if (match === null) throw new Error(`${where}: missing frontmatter`)
  const fields = {}
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator === -1) throw new Error(`${where}: frontmatter line without a key: ${line}`)
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
  }
  return fields
}

/** Every theme has an authored SKILL.md whose frontmatter names the theme and describes it within the catalog cap. */
function validateSkill(packDir, theme) {
  const path = join(packDir, 'skills', theme.id, 'SKILL.md')
  if (!existsSync(path)) throw new Error(`theme ${theme.id} has no authored ${toPosix(relative(packDir, path))}`)
  const fields = parseFrontmatter(readFileSync(path, 'utf8'), path)
  if (fields.name !== theme.id) throw new Error(`${path}: frontmatter name "${fields.name}" must equal the theme id ${theme.id}`)
  if (!SKILL_NAME.test(theme.id)) throw new Error(`theme id ${theme.id} is not kebab-case`)
  if (fields.description === undefined || fields.description === '') throw new Error(`${path}: frontmatter needs a description`)
  if (fields.description.length > DESCRIPTION_MAX) throw new Error(`${path}: description exceeds ${DESCRIPTION_MAX} characters (${fields.description.length})`)
}

function listFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

function main() {
  const request = parseArgs(process.argv.slice(2))
  const packDir = resolve(request.packDir)
  const packPath = join(packDir, 'pack.json')
  if (!existsSync(packPath)) usage(`${packPath} does not exist`)
  const pack = readJson(packPath)
  if (!Array.isArray(pack.themes) || pack.themes.length === 0) throw new Error(`${packPath}: themes must be a non-empty array`)
  if (!Array.isArray(pack.sources) || pack.sources.length === 0) throw new Error(`${packPath}: sources must be a non-empty array`)

  // Planned writes, path → content; applied at the end or compared in --check.
  const planned = new Map()
  const corpusPath = join(packDir, 'corpus', 'items.json')
  let items
  if (request.sweeps !== undefined) {
    const merged = mergeSweeps(pack, resolve(request.sweeps))
    items = merged.items
    planned.set(corpusPath, `${JSON.stringify(items, null, 2)}\n`)
    for (const [source, report] of merged.reports) planned.set(join(packDir, 'corpus', `${source}-report.md`), report.endsWith('\n') ? report : `${report}\n`)
  } else {
    if (!existsSync(corpusPath)) throw new Error(`${corpusPath} does not exist; build once with --sweeps`)
    items = readJson(corpusPath)
    items.forEach((item, index) => validateItem(item, `corpus/items.json[${index}]`))
  }

  const counts = {}
  for (const theme of pack.themes) {
    validateSkill(packDir, theme)
    const selected = items.filter(item => matchesTheme(item, theme))
    counts[theme.id] = selected.length
    planned.set(join(packDir, 'skills', theme.id, 'references', 'items.md'), renderReferences(pack, theme, selected))
  }
  const unmatched = items.filter(item => !pack.themes.some(theme => matchesTheme(item, theme))).map(item => item.id)

  // The manifest covers every file of the pack as it will be on disk after the planned writes.
  const manifestPath = join(packDir, 'manifest.json')
  const contents = new Map()
  for (const path of listFiles(packDir)) {
    if (path === manifestPath) continue
    contents.set(path, readFileSync(path))
  }
  for (const [path, content] of planned) contents.set(path, Buffer.from(content, 'utf8'))
  const files = [...contents.entries()]
    .map(([path, content]) => ({ path: toPosix(relative(packDir, path)), bytes: content.byteLength, sha256: sha256(content) }))
    .sort((a, b) => a.path.localeCompare(b.path))
  const manifest = {
    id: pack.id,
    title: pack.title,
    window: pack.window,
    sources: pack.sources,
    counts: { items: items.length, themes: counts, unmatched },
    files,
  }
  planned.set(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const stale = []
  for (const [path, content] of planned) {
    const current = existsSync(path) ? readFileSync(path, 'utf8') : undefined
    if (current !== content) stale.push(path)
  }
  if (request.check) {
    if (stale.length > 0) {
      console.error(`build-pack: ${pack.id} is stale; rebuild with node data/knowledge/tools/build-pack.mjs ${toPosix(relative(process.cwd(), packDir))}`)
      for (const path of stale) console.error(`  ${toPosix(relative(packDir, path))}`)
      process.exit(1)
    }
    console.log(`build-pack: ${pack.id} is current (${items.length} items, ${pack.themes.length} themes)`)
    return
  }
  for (const path of stale) {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, planned.get(path))
  }
  const themeSummary = pack.themes.map(theme => `${theme.id}=${counts[theme.id]}`).join(' ')
  console.log(`build-pack: ${pack.id}: ${items.length} items; ${themeSummary}; ${stale.length} file(s) written${unmatched.length > 0 ? `; unmatched: ${unmatched.join(', ')}` : ''}`)
  if (statSync(packDir).isDirectory() && files.length === 0) throw new Error('empty pack')
}

main()
