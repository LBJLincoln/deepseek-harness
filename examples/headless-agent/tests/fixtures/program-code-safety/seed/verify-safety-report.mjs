#!/usr/bin/env node
// Mechanical examiner of a code-safety report. It is in the report
// repository's base commit, so no department can change what measures it.
//
//   node verify-safety-report.mjs --findings <path>  one department's findings
//   node verify-safety-report.mjs --findings <path> --list-invalid
//   node verify-safety-report.mjs --report           the merged report
//
// `--findings` decides one findings file against the target tree. Adding
// `--list-invalid` turns the same decision into a report: the failing ids go to
// stdout, one per line, and the exit code is 0, which is how the integration
// learns which findings to drop and disclose.
//
// `--report` decides SAFETY-REPORT.md and findings.json together, including the
// disclosure rule: every id any `findings/<department>.json` carries and
// findings.json does not must be named under `## What was not covered`.
//
// Exit 0 only when every rule holds; otherwise every failure is printed to
// stderr, one per line, and the exit code is 1. Node built-ins only, because
// this runs in a worktree that installs nothing.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'

/** Severities a finding may claim, most severe first. */
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info']

/** How sure a finding's author is that the cited code is exploitable as described. */
const CONFIDENCES = ['confirmed', 'likely', 'possible']

/** Sections SAFETY-REPORT.md carries, in this order. */
const SECTIONS = [
  '## Résumé exécutif',
  '## Executive summary',
  '## Scope and method',
  '## Findings',
  '## What was not covered',
  '## Certificate',
]

/** The claim the certificate must make verbatim, and the only claim this review supports. */
const HONESTY = 'This review does not certify the absence of vulnerabilities; it certifies only that each listed finding was mechanically verified to exist at the cited line, over the files listed in "Scope and method".'

/** Claims no coverage this review can state would support. */
const OVERCLAIMS = /\bno vulnerabilities\b|\bfree of vulnerabilities\b|\b(?:is|are|was|were) secure\b|\bsafe to deploy\b|\bproven secure\b|\bfully audited\b/i

/** Text a report still carrying its template is refused for. */
const PLACEHOLDER = /\bTODO\b|\bTBD\b|\bFIXME\b|lorem ipsum|<placeholder>|PLACEHOLDER/i

/** String fields every finding states in prose. */
const PROSE_FIELDS = ['title', 'evidence', 'impact', 'fix']

/** How a file's text is compared with a finding's quoted snippet. */
const normalize = (text) => text.replace(/\s+/g, ' ').trim()

/** Lowercase hex SHA-256 of one buffer or string. */
const sha256 = (content) => createHash('sha256').update(content).digest('hex')

/**
 * Every file under one directory, relative and sorted, skipping the excluded names.
 * @param {string} root directory to walk
 * @param {string[]} exclude directory basenames never descended into
 * @returns {string[]} relative POSIX-ish paths, sorted
 */
function walk(root, exclude) {
  const found = []
  const descend = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!exclude.includes(entry.name)) descend(path)
      } else if (entry.isFile()) found.push(relative(root, path))
    }
  }
  descend(root)
  return found.sort()
}

/** One target tree as the lock and the verifier both read it: the files, their digests, and their text. */
class Target {
  /**
   * @param {string} reportRoot the report repository the lock is committed in
   * @param {string[]} failures collector every rule appends to
   */
  constructor(reportRoot, failures) {
    this.failures = failures
    this.root = undefined
    this.files = new Map()
    this.lines = new Map()
    const lockPath = join(reportRoot, 'target.json')
    if (!existsSync(lockPath)) {
      failures.push('target.json is missing from this worktree; the base commit carries the lock of the tree under review')
      return
    }
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
    this.root = lock.root
    this.exclude = lock.exclude ?? []
    this.digest = lock.sha256
    for (const [path, hash] of Object.entries(lock.files)) this.files.set(path, hash)
    this.checkTree()
  }

  /**
   * Refuse a target that changed since the base commit locked it: a finding
   * cites a line of the tree this program was asked to review, and a tree a
   * department edited is no longer that tree.
   */
  checkTree() {
    if (!existsSync(this.root)) {
      this.failures.push(`the target tree ${this.root} is not on this host, so no citation can be resolved`)
      this.root = undefined
      return
    }
    const present = walk(this.root, this.exclude)
    for (const path of present) {
      if (!this.files.has(path)) this.failures.push(`the target tree gained ${path} since the base commit locked it`)
    }
    for (const [path, hash] of this.files) {
      if (!present.includes(path)) {
        this.failures.push(`the target tree lost ${path} since the base commit locked it`)
        continue
      }
      if (sha256(readFileSync(join(this.root, path))) !== hash) {
        this.failures.push(`the target tree's ${path} changed since the base commit locked it; the target is read-only for this program`)
      }
    }
  }

  /**
   * The lines of one target file.
   * @param {string} path path relative to the target root
   * @returns {string[] | undefined} the file's lines, or undefined when it is not in the locked tree
   */
  linesOf(path) {
    if (this.root === undefined || !this.files.has(path)) return undefined
    if (!this.lines.has(path)) this.lines.set(path, readFileSync(join(this.root, path), 'utf8').split('\n'))
    return this.lines.get(path)
  }

  /**
   * Whether one `file:line` citation resolves in the locked tree.
   * @param {string} path path relative to the target root
   * @param {number} line 1-based line number
   * @returns {boolean} whether the file is under review and holds that line
   */
  resolves(path, line) {
    const lines = this.linesOf(path)
    return lines !== undefined && Number.isInteger(line) && line >= 1 && line <= lines.length
  }
}

/**
 * Decide one finding against the target tree.
 * @param {unknown} finding one entry of a findings file
 * @param {number} index its position, named when the entry has no usable id
 * @param {Target} target the locked tree the finding cites
 * @param {Set<string>} seen ids already used in this file
 * @returns {string[]} every rule this finding broke, empty when it holds
 */
function checkFinding(finding, index, target, seen) {
  const failures = []
  if (finding === null || typeof finding !== 'object' || Array.isArray(finding)) {
    return [`finding #${index + 1} is not a JSON object`]
  }
  const id = finding.id
  const name = typeof id === 'string' && id !== '' ? id : `#${index + 1}`
  const fail = (rule) => void failures.push(`${name}: ${rule}`)
  // Letters, digits, `-`, `_` and `.`: wide enough for both the `SEC-001`
  // numbering the knowledge pack's schema uses and a department-prefixed name.
  if (typeof id !== 'string' || !/^[A-Za-z0-9][\w.-]*$/.test(id)) fail('id must be letters, digits, dots, dashes or underscores')
  else if (seen.has(id)) fail('id is used twice in this file')
  else seen.add(id)
  if (typeof finding.cwe !== 'string' || !/^CWE-\d+$/.test(finding.cwe)) fail('cwe must match CWE-<number>')
  if (typeof finding.owasp !== 'string' || finding.owasp.trim() === '') fail('owasp must name the category')
  if (!SEVERITIES.includes(finding.severity)) fail(`severity must be one of ${SEVERITIES.join(', ')}`)
  if (!CONFIDENCES.includes(finding.confidence)) fail(`confidence must be one of ${CONFIDENCES.join(', ')}`)
  for (const field of PROSE_FIELDS) {
    if (typeof finding[field] !== 'string' || finding[field].trim() === '') fail(`${field} must be a non-empty string`)
  }
  if (!Array.isArray(finding.references) || finding.references.some(reference => typeof reference !== 'string')) {
    fail('references must be an array of strings')
  }
  const { file, line, endLine, snippet } = finding
  if (typeof file !== 'string' || file === '' || file.startsWith('/') || file.split('/').includes('..')) {
    fail('file must be a path relative to the target root')
    return failures
  }
  const lines = target.linesOf(file)
  if (lines === undefined) {
    fail(`file ${file} is not in the tree under review`)
    return failures
  }
  if (!Number.isInteger(line) || line < 1 || line > lines.length) {
    fail(`line ${JSON.stringify(line)} is outside ${file}, which has ${lines.length} lines`)
    return failures
  }
  const last = endLine === undefined ? line : endLine
  if (!Number.isInteger(last) || last < line || last > lines.length) {
    fail(`endLine ${JSON.stringify(endLine)} is outside ${file}, which has ${lines.length} lines`)
    return failures
  }
  if (typeof snippet !== 'string' || snippet.trim() === '') {
    fail('snippet must quote the cited line')
    return failures
  }
  const quoted = normalize(lines.slice(line - 1, last).join('\n'))
  if (normalize(snippet) !== quoted) {
    fail(`snippet does not match ${file}:${line}, which reads ${JSON.stringify(quoted.slice(0, 160))}`)
  }
  return failures
}

/**
 * Read one findings file.
 * @param {string} path the file to read
 * @param {string[]} failures collector a malformed file is reported on
 * @returns {unknown[]} the entries, empty when the file is missing or malformed
 */
function readFindings(path, failures) {
  if (!existsSync(path)) {
    failures.push(`${path} is missing`)
    return []
  }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    failures.push(`${path} is not JSON: ${error.message}`)
    return []
  }
  if (!Array.isArray(parsed)) {
    failures.push(`${path} must be a JSON array of findings`)
    return []
  }
  return parsed
}

/**
 * Decide one findings file on its own.
 * @param {string} path the findings file
 * @param {Target} target the locked tree it cites
 * @returns {{ failures: string[], invalid: string[], findings: unknown[] }} the broken rules, the ids that broke them, and the entries
 */
function checkFindingsFile(path, target) {
  const failures = []
  const findings = readFindings(path, failures)
  const invalid = []
  const seen = new Set()
  findings.forEach((finding, index) => {
    const broken = checkFinding(finding, index, target, seen)
    if (broken.length === 0) return
    failures.push(...broken.map(rule => `${basename(path)}: ${rule}`))
    invalid.push(typeof finding?.id === 'string' ? finding.id : `#${index + 1}`)
  })
  return { failures, invalid, findings }
}

/**
 * The body of one section of the report.
 * @param {string} text the whole report
 * @param {string} heading the section heading, including its `##`
 * @returns {string} the text between this heading and the next one, empty when absent
 */
function section(text, heading) {
  const start = text.indexOf(`${heading}\n`)
  if (start === -1) return ''
  const body = text.slice(start + heading.length + 1)
  const next = body.search(/^## /m)
  return next === -1 ? body : body.slice(0, next)
}

/**
 * Decide SAFETY-REPORT.md, findings.json and the disclosure of what was dropped.
 * @param {string} root the report repository
 * @param {Target} target the locked tree the report cites
 * @returns {string[]} every rule the report broke
 */
function checkReport(root, target) {
  const reportPath = join(root, 'SAFETY-REPORT.md')
  if (!existsSync(reportPath)) {
    return [`SAFETY-REPORT.md is missing; REPORTING.md in this worktree states the sections it carries: ${SECTIONS.join(', ')}`]
  }
  const text = readFileSync(reportPath, 'utf8')
  const failures = []
  let previous = -1
  for (const heading of SECTIONS) {
    const at = text.indexOf(`${heading}\n`)
    if (at === -1) failures.push(`SAFETY-REPORT.md has no section ${JSON.stringify(heading)}`)
    else if (at < previous) failures.push(`SAFETY-REPORT.md has ${JSON.stringify(heading)} out of order; the order is ${SECTIONS.join(' then ')}`)
    else previous = at
  }
  const placeholder = PLACEHOLDER.exec(text)
  if (placeholder !== null) failures.push(`SAFETY-REPORT.md still carries placeholder text: ${JSON.stringify(placeholder[0])}`)
  const overclaim = OVERCLAIMS.exec(text)
  if (overclaim !== null) failures.push(`SAFETY-REPORT.md claims more than this review supports: ${JSON.stringify(overclaim[0])}`)

  const union = checkFindingsFile(join(root, 'findings.json'), target)
  failures.push(...union.failures)
  const findings = union.findings.filter(finding => typeof finding?.id === 'string')

  const keys = new Set()
  for (const finding of findings) {
    const key = `${finding.file}:${finding.line}:${finding.cwe}`
    if (keys.has(key)) failures.push(`findings.json states ${key} twice; the union is deduplicated by file, line and cwe`)
    keys.add(key)
  }

  const listed = section(text, '## Findings')
  for (const finding of findings) {
    if (!listed.includes(finding.id)) failures.push(`the Findings section does not cite ${finding.id}`)
  }
  // The lookbehind keeps a URL's `host:port` out of the citation vocabulary:
  // the host is preceded by a slash, so no citation ever starts there.
  for (const [, path, line] of text.matchAll(/(?<![\w/.\-])([\w.-]+(?:\/[\w.-]+)*\.\w+):(\d+)\b/g)) {
    if (!target.resolves(path, Number(line))) failures.push(`the citation ${path}:${line} does not resolve in the tree under review`)
  }

  const counts = Object.fromEntries(SEVERITIES.map(severity => [severity, findings.filter(finding => finding.severity === severity).length]))
  for (const heading of ['## Résumé exécutif', '## Executive summary']) {
    const body = section(text, heading)
    for (const severity of SEVERITIES) {
      const stated = new RegExp(`^- ${severity}: (\\d+)$`, 'm').exec(body)
      if (stated === null) failures.push(`${heading} does not state a "- ${severity}: <count>" line`)
      else if (Number(stated[1]) !== counts[severity]) {
        failures.push(`${heading} states ${severity}: ${stated[1]}, and findings.json holds ${counts[severity]}`)
      }
    }
  }

  const uncovered = section(text, '## What was not covered')
  const department = join(root, 'findings')
  const dropped = []
  if (existsSync(department)) {
    for (const entry of readdirSync(department).sort()) {
      if (!entry.endsWith('.json')) continue
      for (const finding of readFindings(join(department, entry), failures)) {
        if (typeof finding?.id !== 'string') continue
        if (!findings.some(kept => kept.id === finding.id)) dropped.push(finding.id)
      }
    }
  }
  for (const id of dropped) {
    if (!uncovered.includes(id)) {
      failures.push(`${id} was dropped from findings.json and is not disclosed under "## What was not covered"`)
    }
  }

  const certificate = section(text, '## Certificate')
  if (!certificate.includes(HONESTY)) failures.push(`the Certificate must state, verbatim: ${JSON.stringify(HONESTY)}`)
  const stated = /^Verified findings: (\d+)$/m.exec(certificate)
  if (stated === null) failures.push('the Certificate does not state a "Verified findings: <count>" line')
  else if (Number(stated[1]) !== findings.length) failures.push(`the Certificate states ${stated[1]} verified findings, and findings.json holds ${findings.length}`)
  const tree = /^Target tree: ([0-9a-f]{64})$/m.exec(certificate)
  if (tree === null) failures.push('the Certificate does not state a "Target tree: <sha256>" line')
  else if (tree[1] !== target.digest) failures.push(`the Certificate states target tree ${tree[1]}, and target.json locks ${target.digest}`)
  return failures
}

const argv = process.argv.slice(2)
const root = resolve(process.cwd())
const listInvalid = argv.includes('--list-invalid')
const findingsAt = argv.indexOf('--findings')
const failures = []
const target = new Target(root, failures)

if (findingsAt !== -1) {
  const path = argv[findingsAt + 1]
  if (path === undefined) {
    console.error('FAIL --findings needs a path')
    process.exit(1)
  }
  const checked = checkFindingsFile(resolve(root, path), target)
  if (listInvalid) {
    for (const id of checked.invalid) console.log(id)
    process.exit(0)
  }
  failures.push(...checked.failures)
  // A department that found nothing states `[]` and says so in its report
  // section: requiring a finding would buy one by inventing it.
  if (failures.length === 0) console.log(`ok: ${checked.findings.length} findings verified against ${target.root}`)
} else if (argv.includes('--report')) {
  failures.push(...checkReport(root, target))
  if (failures.length === 0) console.log(`ok: SAFETY-REPORT.md and findings.json verified against ${target.root}`)
} else {
  console.error('usage: verify-safety-report.mjs --findings <path> [--list-invalid] | --report')
  process.exit(1)
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`)
  process.exit(1)
}
process.exit(0)
