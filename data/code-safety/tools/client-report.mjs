#!/usr/bin/env node
// Renders one code-safety record as a client-facing security assessment: a
// Markdown file and a print-ready HTML file under
// data/code-safety/reports/<record>/, both built from the record's own files
// and nothing else the run did not write. The record itself is never edited.
//
// The assessment holds a cover block with the record's target, dates, reviewer
// and examiner verdict; an executive summary with the severity counts and the
// five most urgent remediations; the scope and method; the findings ranked by
// severity with the quoted line, evidence, impact and fix of each; recall
// against the target's documented issues when targets/ holds a ground truth,
// or the seeded reading and its Wilson interval for a record of a seeded copy;
// the limitations; the data handling; and an appendix of paths and digests.
//
// Usage: node client-report.mjs [<record dir>] [--check | --print] [--pdf <file>]
//   <record dir>  a record under data/code-safety/; by default the NodeGoat
//                 record whose manifest `ranAt` is latest
//   --check       render in memory and exit 1 when either committed file
//                 differs from the rendering; writes nothing
//   --print       write the Markdown to stdout instead of the report directory
//   --pdf <file>  also print the HTML to a PDF through playwright-core's
//                 Chromium; PLAYWRIGHT_CORE names the playwright-core package
//                 directory when the package does not resolve from here, and
//                 PLAYWRIGHT_CHROMIUM the browser executable when playwright's
//                 own browser is not installed. The PDF is not committed.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { score } from './seeded-recall.mjs'

const TOOLS_DIR = import.meta.dirname
const RECORDS_DIR = resolve(TOOLS_DIR, '..')
const REPO_DIR = resolve(RECORDS_DIR, '..', '..')
const REPORTS_DIR = join(RECORDS_DIR, 'reports')
/** Links in the HTML and the PDF point at the repository's published branch. */
const BLOB_BASE = 'https://github.com/LBJLincoln/deepseek-harness/blob/claude/coding-agent-harness-u9l4gt'
const MD_NAME = 'SECURITY-ASSESSMENT.md'
const HTML_NAME = 'SECURITY-ASSESSMENT.html'

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info']
const SEVERITY_COLOR = { critical: '#8f1d21', high: '#c2410c', medium: '#a16207', low: '#1d4ed8', info: '#475569' }

/** What each department reviews, as the program's README states it. */
const DEPARTMENT_SUBJECT = {
  secrets: 'hard-coded credentials, tokens and keys, leaked `.env` and configuration',
  injection: 'SQL, NoSQL, command, template and code injection, XSS, path traversal, SSRF, log injection, ReDoS',
  access: 'authentication (including account enumeration and password policy), session handling, authorization, IDOR, CSRF',
  data: 'sensitive-data exposure, PII in logs, cleartext transport, weak crypto, password storage',
  dependencies: 'vulnerable and outdated packages, from `npm audit --json` or the manifest',
  platform: 'headers, CORS, cookies, error handling, rate limiting, misconfiguration, client-side code',
  generalist: 'the whole application end to end, any defect class in one pass',
}

/**
 * The public training applications targets/ holds a documented ground truth for: what each one is, and the
 * knowledge-pack digests whose checklists were written from that target's own misses, so a reading on them is
 * in-sample (.agents/notes/proposed/process/2026-09-27-code-safety-misses-diagnosis.md).
 */
const TRAINING_TARGETS = {
  nodegoat: {
    what: 'OWASP NodeGoat is an intentionally vulnerable Node.js and Express web application that the OWASP project publishes for security training. Its defects were put there on purpose, and its tutorial documents them.',
    inSample: { '0ec2cc9b3913a0a7c0120ecbaeeb313842a0a1a0a012176661746b81e5a78795': 'the diagnosed checklists, written from the misses of earlier reviews of this target' },
  },
  dvja: {
    what: 'Damn Vulnerable Java Application (dvja) is an intentionally vulnerable Java Struts 2 and Spring application published for security training. Its defects were put there on purpose and are documented.',
    inSample: {},
  },
}

const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const asFindings = raw => (Array.isArray(raw) ? raw : raw.findings ?? [])
const grouped = value => value.toLocaleString('en-US')
const capital = word => word.charAt(0).toUpperCase() + word.slice(1)
const percent = (part, whole) => `${Math.round((part / whole) * 100)}%`
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const day = iso => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` }
const clock = iso => new Date(iso).toISOString().slice(11, 16)
const repoPath = path => relative(REPO_DIR, path).split('\\').join('/')

/**
 * Picks the default record: the one for the given target slug whose manifest `ranAt` is latest.
 * @param {string} slug a target slug that record directory names carry, such as `nodegoat`
 * @returns {string} the record directory
 */
function latestRecord(slug) {
  const records = readdirSync(RECORDS_DIR)
    .filter(name => /^\d{4}-\d{2}-\d{2}-/.test(name) && name.includes(slug) && existsSync(join(RECORDS_DIR, name, 'manifest.json')))
    .map(name => ({ dir: join(RECORDS_DIR, name), ranAt: readJson(join(RECORDS_DIR, name, 'manifest.json')).ranAt }))
    .sort((a, b) => a.ranAt.localeCompare(b.ranAt))
  if (records.length === 0) throw new Error(`client-report: no record for ${slug} under ${RECORDS_DIR}`)
  return records.at(-1).dir
}

/**
 * The slug of the training target a record reviewed, when targets/ holds its documented ground truth.
 * @param {string} name the record's directory name
 * @returns {string | undefined} the slug, or undefined for any other target
 */
function trainingSlug(name) {
  return Object.keys(TRAINING_TARGETS).find(slug => name.includes(slug) && existsSync(join(RECORDS_DIR, 'targets', `${slug}.ground-truth.json`)))
}

/**
 * Sums the token usage a record's session logs carry, one `usage` chunk per model response, and names the models
 * their requests named.
 * @param {string} recordDir the record directory
 * @returns {{ input: number, output: number, cacheRead: number, cacheWrite: number, total: number, models: string[] }} the tokens and models
 */
function recordUsage(recordDir) {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const models = new Set()
  const sessions = join(recordDir, 'sessions')
  for (const file of readdirSync(sessions).filter(name => name.endsWith('.jsonl'))) {
    for (const line of readFileSync(join(sessions, file), 'utf8').split('\n')) {
      for (const match of line.matchAll(/"model":"([^"]+)"/g)) models.add(match[1])
      if (!line.includes('"assistant/chunk"')) continue
      const event = JSON.parse(line)
      const usage = event.data?.chunk?.type === 'usage' ? event.data.chunk.usage : undefined
      if (usage === undefined) continue
      tokens.input += usage.inputTokens ?? 0
      tokens.output += usage.outputTokens ?? 0
      tokens.cacheRead += usage.cacheReadTokens ?? 0
      tokens.cacheWrite += usage.cacheWriteTokens ?? 0
    }
  }
  return { ...tokens, total: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite, models: [...models].sort() }
}

/**
 * Reads everything the assessment states from one record and the files beside it.
 * @param {string} recordDir the record directory
 * @returns {object} the assessment's data
 */
export function readAssessment(recordDir) {
  const name = basename(recordDir)
  const manifest = readJson(join(recordDir, 'manifest.json'))
  const findings = asFindings(readJson(join(recordDir, 'findings.json')))
  const verifierText = readFileSync(join(recordDir, 'verifier.txt'), 'utf8').trim()
  const slug = trainingSlug(name)
  const truthPath = slug === undefined ? undefined : join(RECORDS_DIR, 'targets', `${slug}.ground-truth.json`)
  const truth = truthPath === undefined ? undefined : readJson(truthPath)
  const seeded = manifest.seeded !== undefined && existsSync(join(recordDir, 'seeded.ground-truth.json'))
    ? { truth: readJson(join(recordDir, 'seeded.ground-truth.json')), reading: readJson(join(recordDir, 'seeded-recall.json')) }
    : undefined
  const recall = truth === undefined ? undefined : score(findings, truth)
  const matched = new Map()
  for (const row of recall?.rows ?? []) {
    for (const hit of row.by) {
      const id = hit.split('@')[0]
      matched.set(id, [...(matched.get(id) ?? []), row.id])
    }
  }
  const seededHits = new Map()
  for (const row of seeded === undefined ? [] : score(findings, seeded.truth).rows) {
    for (const hit of row.by) seededHits.set(hit.split('@')[0], row.id)
  }
  const rank = finding => SEVERITIES.indexOf(finding.severity)
  const ranked = findings
    .map((finding, index) => ({ ...finding, index, issues: matched.get(finding.id) ?? [], canary: seededHits.get(finding.id) }))
    .sort((a, b) => rank(a) - rank(b) || a.index - b.index)
    .map((finding, position) => ({ ...finding, ref: `F-${String(position + 1).padStart(2, '0')}` }))
  const siblings = slug === undefined ? [] : readdirSync(RECORDS_DIR)
    .filter(other => /^\d{4}-\d{2}-\d{2}-/.test(other) && other.includes(slug) && existsSync(join(RECORDS_DIR, other, 'findings.json')))
    .map((other) => {
      const otherManifest = readJson(join(RECORDS_DIR, other, 'manifest.json'))
      return { name: other, found: score(asFindings(readJson(join(RECORDS_DIR, other, 'findings.json'))), truth).caught, knowledge: otherManifest.knowledge?.sha256 ?? null }
    })
  return {
    name,
    recordPath: repoPath(recordDir),
    manifest,
    findings: ranked,
    verifierText,
    slug,
    training: slug === undefined ? undefined : TRAINING_TARGETS[slug],
    truth,
    truthPath: truthPath === undefined ? undefined : repoPath(truthPath),
    recall,
    seeded,
    siblings,
    tokens: recordUsage(recordDir),
    reportPath: repoPath(join(REPORTS_DIR, name)),
  }
}

/**
 * The five most urgent remediations: every dependency finding is one upgrade, every other finding its own item;
 * items rank by their most severe finding, then by whether a documented issue corroborates them, then by size.
 * @param {object[]} findings the ranked findings
 * @returns {object[]} up to five items, each with a title, its findings and its fix
 */
function topFixes(findings) {
  const items = new Map()
  for (const finding of findings) {
    if (finding.canary !== undefined) continue
    const key = finding.id.startsWith('dependencies') ? 'dependencies' : finding.id
    items.set(key, [...(items.get(key) ?? []), finding])
  }
  const rank = list => Math.min(...list.map(finding => SEVERITIES.indexOf(finding.severity)))
  const corroborated = list => list.some(finding => finding.issues.length > 0)
  return [...items.entries()]
    .sort(([, a], [, b]) => rank(a) - rank(b) || Number(corroborated(b)) - Number(corroborated(a)) || b.length - a.length || a[0].index - b[0].index)
    .slice(0, 5)
    .map(([key, list]) => key === 'dependencies'
      ? { severity: SEVERITIES[rank(list)], title: `Upgrade or replace the ${list.length} dependencies with known advisories or no maintenance`, refs: list.map(finding => finding.ref), where: 'package.json', fix: 'Move each package named in the dependency findings to a release its advisories list as fixed, or replace an unmaintained package, then re-run the dependency audit against the new lockfile.' }
      : { severity: list[0].severity, title: list[0].title, refs: [list[0].ref], where: `${list[0].file}:${list[0].line}`, fix: list[0].fix })
}

// ---------------------------------------------------------------------------
// The document model: one list of blocks rendered to Markdown and to HTML.

const escapeHtml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const cell = text => String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ')
/** Collapses whitespace runs to one space, so a finding's free text is one Markdown paragraph. */
const flat = text => String(text).replace(/\s+/g, ' ')
/** Escapes free text for HTML and renders its backtick spans as code, as Markdown does. */
const htmlText = text => flat(text).split(/(`+[^`]*`+)/).map((part, index) => (index % 2 === 1 ? `<code>${escapeHtml(part.replace(/^`+ ?| ?`+$/g, ''))}</code>` : escapeHtml(part).replace(/\bF-\d{2}\b/g, '<span class="ref">$&</span>'))).join('')
/** Escapes the characters Markdown would read as HTML, outside inline code spans. */
const escapeMd = text => flat(text).split(/(`+[^`]*`+)/).map((part, index) => (index % 2 === 1 ? part : part.replace(/</g, '&lt;').replace(/>/g, '&gt;'))).join('')
const code = (text) => {
  const value = String(text)
  const fence = '`'.repeat(Math.max(0, ...[...value.matchAll(/`+/g)].map(run => run[0].length)) + 1)
  return fence.length > 1 ? `${fence} ${value} ${fence}` : `\`${value}\``
}

/**
 * Inline text: a list of runs, each plain, bold, code, a line break (a space in Markdown) or a link to a repository path,
 * with an optional fragment, or to a URL.
 * @param {Array<string | { b?: string, c?: string, br?: true, link?: string, path?: string, hash?: string, href?: string }>} runs the runs
 * @param {'md' | 'html'} format the output format
 * @param {string} from the repository directory a Markdown link is relative to
 * @returns {string} the rendered text
 */
function inline(runs, format, from) {
  return runs.map((run) => {
    if (typeof run === 'string') return format === 'md' ? escapeMd(run) : htmlText(run)
    if (run.br !== undefined) return format === 'md' ? ' ' : '<br>'
    if (run.b !== undefined) {
      const [, lead, core, trail] = /^(\s*)(.*?)(\s*)$/s.exec(run.b)
      return format === 'md' ? `${lead}**${escapeMd(core)}**${trail}` : `${lead}<strong>${htmlText(core)}</strong>${trail}`
    }
    if (run.c !== undefined) return format === 'md' ? code(run.c) : `<code>${escapeHtml(run.c)}</code>`
    const target = run.path !== undefined
      ? (format === 'md' ? relative(from, run.path).split('\\').join('/') + (run.hash ?? '') : `${BLOB_BASE}/${run.path}${run.hash ?? ''}`)
      : run.href
    return format === 'md' ? `[${run.link}](${target})` : `<a href="${escapeHtml(target)}">${escapeHtml(run.link)}</a>`
  }).join('')
}

/**
 * Builds the assessment's blocks.
 * @param {object} a the assessment's data from readAssessment
 * @returns {object[]} the blocks
 */
function blocks(a) {
  const m = a.manifest
  const bySeverity = m.findings?.bySeverity ?? Object.fromEntries(SEVERITIES.map(severity => [severity, a.findings.filter(finding => finding.severity === severity).length]))
  const total = a.findings.length
  const targetName = a.truth?.target ?? basename(m.target.root)
  const onKnown = a.findings.filter(finding => finding.issues.length > 0).length
  const beyond = total - onKnown - a.findings.filter(finding => finding.canary !== undefined).length
  const certified = m.certified.filter(key => key !== '@integration')
  const departments = m.departments.map(department => department.key)
  const confirmedCount = a.findings.filter(finding => finding.confidence === 'confirmed').length
  const out = []
  const p = (...runs) => out.push({ type: 'p', runs })
  const h = (level, text, id) => out.push({ type: 'h', level, text, id })
  const list = items => out.push({ type: 'list', items })
  const table = (head, rows, className) => out.push({ type: 'table', head, rows, className })

  out.push({ type: 'title', text: `Security assessment: ${targetName}`, sub: `Code-safety review record ${a.name}` })
  if (a.training !== undefined) out.push({ type: 'notice', kind: 'training', runs: [{ b: 'Training target, not a client system. ' }, a.training.what, ' This assessment demonstrates the review; it assesses no client code.'] })
  if (a.seeded !== undefined) out.push({ type: 'notice', kind: 'seeded', runs: [{ b: `Seeded copy. ` }, `The review ran on a copy of the target into which ${a.seeded.reading.n} defects were planted without the review being told; findings on planted lines are canaries, not defects of the product.`] })
  table(['Item', 'Value'], [
    [['Target'], [`${targetName}: the tree the record locks, ${grouped(m.target.files)} files, read-only${a.truth === undefined ? '' : `; the documented issues are pinned to revision ${a.truth.revision.slice(0, 7)}`}`]],
    [['Review ran'], [`${day(m.ranAt)}, ${clock(m.ranAt)} to ${clock(m.endedAt)} UTC (${grouped(m.elapsedSeconds)} s)`]],
    [['Reviewer'], [`The Daliesk code-safety program: ${departments.length} departments and an integration on the model `, ...a.tokens.models.flatMap((model, index) => [index === 0 ? '' : ', ', { c: model }]), ` through the operator's Claude Code login; ${certified.length} of ${departments.length} departments and the integration certified`]],
    [['Program revision'], [{ c: m.repository.head.slice(0, 9) }, m.knowledge === undefined ? '' : ', knowledge pack ', m.knowledge === undefined ? '' : { c: `${m.knowledge.sha256.slice(0, 8)}…` }]],
    [['Examiner'], [m.verifier.exitCode === 0 ? `Exit 0: every one of the ${total} findings is line-verified` : `Exit ${m.verifier.exitCode}: the examiner refused the release, so no finding below is line-verified`]],
    [['Classification'], ['Public: the record and this assessment are published in a public repository']],
    [['Generated from'], [{ link: a.recordPath, path: a.recordPath }, ' by ', { link: 'client-report.mjs', path: 'data/code-safety/tools/client-report.mjs' }]],
  ], 'control')

  h(2, '1. Executive summary', 'summary')
  out.push({ type: 'bar', counts: bySeverity, total })
  list([
    [{ b: `${total} findings: ` }, SEVERITIES.map(severity => `${bySeverity[severity] ?? 0} ${severity}`).join(', '), '. ', { b: 'Line-verified' }, ` means the committed examiner found each finding's quoted text at the cited line of the cited file in the locked tree (exit ${m.verifier.exitCode}). It does not show that a finding is exploitable: nothing was executed.`],
    ...(a.recall === undefined ? [] : [[{ b: `${a.recall.caught} of the ${a.recall.n} documented issues found (${percent(a.recall.caught, a.recall.n)}). ` }, 'A documented issue counts as found when a finding cites its file within three lines of it. ', a.recall.caught === a.recall.n ? 'None was missed.' : `Missed: ${a.recall.rows.filter(row => !row.found).map(row => `${row.id} (${row.category})`).join('; ')}.`]]),
    ...(a.recall === undefined ? [] : [[{ b: `${onKnown} findings land on a documented issue; ${beyond} are beyond the documented list` }, ' and have not been triaged. Treat those as candidates for your security team to confirm or dismiss, not as established defects.']]),
    ...(a.seeded === undefined ? [] : [[{ b: `Seeded recall ${a.seeded.reading.caught} of ${a.seeded.reading.n}, 95% interval [${a.seeded.reading.interval.low}, ${a.seeded.reading.interval.high}]` }, ', counting a finding within three lines of a planted site.']]),
    [{ b: 'Confidence is the department\'s own label. ' }, `${confirmedCount} of ${total} findings are labelled confirmed; no reproduction or human triage stands behind that label. In the one review whose findings were triaged, four findings labelled confirmed were false positives (`, { link: 'the triage', path: 'data/code-safety/targets/README.md', hash: '#the-2026-09-28-review-and-its-triage' }, ').'],
  ])
  h(3, 'The five most urgent remediations', 'top-fixes')
  table(['#', 'Severity', 'Remediation', 'Where', 'Findings'], topFixes(a.findings).map((item, index) => [[String(index + 1)], [{ sev: item.severity }], [{ b: item.title }, { br: true }, item.fix], [{ c: item.where }], [item.refs.join(', ')]]), 'fixes')

  h(2, '2. Scope and method', 'scope')
  list([
    [{ b: 'Target. ' }, `${targetName}, ${grouped(m.target.files)} files locked read-only; the examiner re-hashed every locked file before accepting any finding. The locked tree's SHA-256 is in Appendix A.`],
    [{ b: 'Departments. ' }, `${departments.length} departments ran in parallel, each in its own worktree and session: `, departments.map(key => `${key} (${(DEPARTMENT_SUBJECT[key] ?? 'its own subject').replace(/`/g, '')})`).join('; '), '. An integration merged their findings, removed duplicates by file, line and CWE, and wrote the report.'],
    [{ b: 'Tools. ' }, 'Each department ran the static scanner ', { c: 'semgrep' }, ' with the program\'s local rules and the ', { c: 'p/owasp-top-ten' }, ' registry pack, reading every hit before it became a finding; the dependencies department ran ', { c: 'npm audit --json' }, ' against the target\'s lockfile.'],
    [{ b: 'Model and usage. ' }, `Every department and the integration ran through the operator's Claude Code login. The record's session logs carry ${grouped(a.tokens.total)} tokens (${grouped(a.tokens.output)} output, ${grouped(a.tokens.cacheRead)} cache read, ${grouped(a.tokens.cacheWrite)} cache write, ${grouped(a.tokens.input)} uncached input).`],
    [{ b: 'Verification. ' }, 'The committed examiner checks that every finding\'s file exists in the locked tree, the line is inside it, the quoted snippet matches the code at that line, the identifiers are well formed, and the report cites every finding with the same counts; its output is ', { c: a.verifierText.split('\n').at(-1) }, '.'],
    ...(a.truth === undefined ? [] : [[{ b: 'Recall. ' }, `Read after the review from `, { link: a.truthPath, path: a.truthPath }, `, ${a.truth.issues.length} issues the application documents, never shown to the review.`]]),
  ])

  h(2, '3. Findings', 'findings')
  p(`Ranked by severity, then in the order the record lists them. Severity follows the program's written rubric as a model applied it; your security team sets the final severity.`)
  table(['Ref', 'Severity', 'Finding', 'Location', 'CWE', a.seeded === undefined ? 'Documented issue' : 'Planted defect'], a.findings.map(finding => [
    [finding.ref], [{ sev: finding.severity }], [finding.title], [{ c: `${finding.file}:${finding.line}` }], [finding.cwe],
    [a.seeded === undefined ? (finding.issues.length > 0 ? finding.issues.join(', ') : 'beyond the list, untriaged') : (finding.canary ?? 'not planted')],
  ]), 'findings')

  if (a.recall !== undefined) {
    h(2, '4. Recall against the documented issues', 'recall')
    p(`${a.recall.caught} of ${a.recall.n}. A documented issue counts as found when a finding cites its file within three lines of the issue's lines or of another location the list gives for the same defect.`)
    table(['Issue', 'Category', 'CWE', 'Where', 'Found by'], a.recall.rows.map(row => [[row.id], [row.category], [row.cwe], [{ c: row.file }], [row.found ? [...new Set(row.by.map(hit => a.findings.find(finding => finding.id === hit.split('@')[0])?.ref ?? hit))].sort().join(', ') : 'missed']]), 'recall')
    const groups = new Map()
    for (const sibling of a.siblings) {
      const key = sibling.knowledge ?? 'not recorded'
      groups.set(key, [...(groups.get(key) ?? []), sibling])
    }
    p(`This record is one of ${a.siblings.length} reviews of ${targetName} on file. Grouped by the knowledge pack the departments read:`)
    table(['Knowledge pack', 'Reviews', 'Documented issues found', 'Note'], [...groups.entries()].map(([key, rows]) => {
      const founds = rows.map(row => row.found)
      const note = a.training.inSample[key]
      return [[key === 'not recorded' ? key : { c: `${key.slice(0, 8)}…` }], [String(rows.length)], [`${Math.min(...founds)} to ${Math.max(...founds)} of ${a.recall.n}`.replace(/^(\d+) to \1 /, '$1 ')], [rows.some(row => row.name === a.name) ? 'includes this record' : '', note === undefined ? '' : `${rows.some(row => row.name === a.name) ? '; ' : ''}in-sample: ${note}`]]
    }), 'groups')
  }

  h(2, `${a.recall === undefined ? 4 : 5}. Limitations`, 'limitations')
  list([
    ...(a.training === undefined ? [] : [[{ b: 'A training application. ' }, `${targetName} was written to contain these defects. How the review performs on a production codebase, with no documented list to score against, is measured by planting defects in a copy of it (`, { link: 'seeded recall', path: 'data/code-safety/README.md', hash: '#recall-without-a-ground-truth-seeded-defects' }, ').']]),
    [{ b: 'Static review only. ' }, 'Nothing was run, fuzzed or exploited. A line-verified finding shows that the cited code is present, not that an attacker can reach it.'],
    [{ b: 'One run. ' }, 'A model-driven review varies from run to run: two reviews of the same NodeGoat revision on one composition matched 38 of the first run\'s 42 findings with a finding within three lines of the same file, 31 of them with the same CWE (', { link: 'the records', path: 'data/code-safety/README.md', hash: '#what-a-record-proves' }, ').'],
    [{ b: 'Untriaged findings and department confidence. ' }, 'No finding in this record was triaged by a person or reproduced; the confidence labels are the departments\' own.'],
    [{ b: 'Coverage. ' }, 'The record\'s own report lists what the review did not reach, such as dynamic testing, git history and vendored front-end code, under ', { c: '## What was not covered' }, ' (', { link: 'SAFETY-REPORT.md', path: `${a.recordPath}/SAFETY-REPORT.md` }, ').'],
  ])

  h(2, `${a.recall === undefined ? 5 : 6}. Data handling`, 'data-handling')
  p('Every model request of this review, with the text of each file a department read, went to Anthropic\'s model API under the operator\'s Claude Code login, and the record, session logs included, is committed to a public repository. That is acceptable for a public training application and not for client code. ', { link: 'Data handling', path: 'docs/client/data-handling.md' }, ' states every destination, the terms of each, and what a client engagement requires first: an API organisation under a data processing agreement with zero data retention, and records kept out of the public repository.')

  h(2, 'Appendix A. Record, paths and digests', 'appendix')
  table(['Item', 'Value'], [
    [['Record'], [{ link: a.recordPath, path: `${a.recordPath}/manifest.json` }]],
    [['Program id'], [{ c: m.programId }]],
    [['Repository head'], [{ c: m.repository.head }]],
    [['Merged revision of the report repository'], [{ c: m.mergedRevision }]],
    [['Locked target'], [{ c: m.target.root }, `, ${grouped(m.target.files)} files, SHA-256 `, { c: m.target.sha256 }]],
    ...(m.knowledge === undefined ? [] : [[['Knowledge pack'], [{ c: m.knowledge.root }, `, ${m.knowledge.files} files, SHA-256 `, { c: m.knowledge.sha256 }]]]),
    [['Composition'], [{ c: m.composition }]],
  ], 'appendix')
  table(['Record file', 'Bytes', 'SHA-256'], m.files.map(file => [[{ c: file.path }], [grouped(file.bytes)], [{ c: file.sha256 }]]), 'digests')
  h(2, 'Appendix B. Finding details', 'details')
  for (const finding of a.findings) {
    out.push({ type: 'finding', finding, seeded: a.seeded !== undefined })
  }
  h(2, 'Appendix C. Regenerate this assessment', 'regenerate')
  out.push({ type: 'code', text: `node data/code-safety/tools/client-report.mjs ${a.recordPath}\nnode data/code-safety/tools/recall.mjs ${a.recordPath}${a.truthPath === undefined ? '' : ` ${a.truthPath}`}` })
  return out
}

// ---------------------------------------------------------------------------
// Renderers.

/**
 * Renders the blocks as Markdown, links relative to the report's directory.
 * @param {object[]} list the blocks
 * @param {string} reportPath the report directory, relative to the repository
 * @returns {string} the Markdown
 */
function toMarkdown(list, reportPath) {
  const from = reportPath
  const text = runs => inline(runs.map(run => (run?.sev !== undefined ? capital(run.sev) : run)), 'md', from)
  const lines = []
  for (const block of list) {
    if (block.type === 'title') lines.push(`# ${block.text}`, '', block.sub, '')
    else if (block.type === 'notice') lines.push(`> ${text(block.runs)}`, '')
    else if (block.type === 'h') lines.push(`${'#'.repeat(block.level)} ${block.text}`, '')
    else if (block.type === 'p') lines.push(text(block.runs), '')
    else if (block.type === 'list') lines.push(...block.items.map(item => `- ${text(item)}`), '')
    else if (block.type === 'bar') lines.push(`| ${SEVERITIES.map(capital).join(' | ')} | Total |`, `| ${SEVERITIES.map(() => '---:').join(' | ')} | ---: |`, `| ${SEVERITIES.map(severity => block.counts[severity] ?? 0).join(' | ')} | ${block.total} |`, '')
    else if (block.type === 'table') lines.push(`| ${block.head.join(' | ')} |`, `| ${block.head.map(() => '---').join(' | ')} |`, ...block.rows.map(row => `| ${row.map(value => cell(text(value))).join(' | ')} |`), '')
    else if (block.type === 'code') lines.push('```sh', block.text, '```', '')
    else if (block.type === 'finding') {
      const f = block.finding
      const fence = '`'.repeat(Math.max(3, ...[...String(f.snippet).matchAll(/`+/g)].map(run => run[0].length + 1)))
      lines.push(`### ${f.ref}. ${capital(f.severity)}: ${escapeMd(f.title).trim()}`, '')
      lines.push(`- ${text([{ b: 'Location: ' }, { c: `${f.file}:${f.line}` }, `; ${f.cwe}${f.owasp === undefined ? '' : `; ${f.owasp}`}; department confidence ${f.confidence}; `, block.seeded ? (f.canary === undefined ? 'not a planted site' : `planted defect ${f.canary}`) : (f.issues.length > 0 ? `documented issue ${f.issues.join(', ')}` : 'beyond the documented list, untriaged')])}`, '')
      lines.push(fence, f.snippet, fence, '')
      lines.push(`${text([{ b: 'Evidence. ' }, f.evidence])}`, '', `${text([{ b: 'Impact. ' }, f.impact])}`, '', `${text([{ b: 'Fix. ' }, f.fix])}`, '')
    }
  }
  return `${lines.join('\n').trimEnd()}\n`
}

const CSS = `
:root { --ink: #111827; --muted: #4b5563; --rule: #d1d5db; --paper: #ffffff; --band: #f3f4f6; --accent: #0f4c5c; }
* { box-sizing: border-box; }
html { background: var(--paper); }
body { margin: 0 auto; max-width: 190mm; padding: 16px; color: var(--ink); background: var(--paper); font: 10.5pt/1.5 "Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif; }
h1 { font-size: 22pt; line-height: 1.2; margin: 0 0 4px; color: var(--accent); }
.sub { color: var(--muted); margin: 0 0 14px; }
h2 { font-size: 14pt; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 2px solid var(--accent); color: var(--accent); }
h3 { font-size: 11.5pt; margin: 16px 0 6px; }
p, li { margin: 0 0 6px; }
ul { padding-left: 18px; margin: 0 0 10px; }
a { color: var(--accent); }
code { font: 9pt/1.4 "DejaVu Sans Mono", Menlo, Consolas, monospace; background: var(--band); padding: 0 3px; border-radius: 2px; overflow-wrap: anywhere; }
pre { font: 8.5pt/1.45 "DejaVu Sans Mono", Menlo, Consolas, monospace; background: var(--band); border-left: 3px solid var(--rule); padding: 6px 8px; margin: 6px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.notice { border: 1px solid; border-radius: 4px; padding: 8px 10px; margin: 0 0 12px; }
.notice.training { border-color: #a16207; background: #fefce8; }
.notice.seeded { border-color: #8f1d21; background: #fef2f2; }
table { width: 100%; border-collapse: collapse; margin: 6px 0 12px; font-size: 9pt; }
th, td { text-align: left; vertical-align: top; padding: 4px 6px; border-bottom: 1px solid var(--rule); }
th { background: var(--band); font-weight: 600; }
table.control td:first-child, table.appendix td:first-child { width: 28%; font-weight: 600; }
table.findings, table.fixes, table.recall { table-layout: fixed; }
table.findings td:first-child, table.fixes td:first-child, table.findings td:nth-child(5), table.recall td:nth-child(3) { white-space: nowrap; }
table.findings th:nth-child(1) { width: 7%; } table.findings th:nth-child(2) { width: 11%; } table.findings th:nth-child(3) { width: 38%; }
table.findings th:nth-child(4) { width: 22%; } table.findings th:nth-child(5) { width: 10%; } table.findings th:nth-child(6) { width: 12%; }
table.fixes th:nth-child(1) { width: 4%; } table.fixes th:nth-child(2) { width: 11%; } table.fixes th:nth-child(3) { width: 51%; }
table.fixes th:nth-child(4) { width: 18%; } table.fixes th:nth-child(5) { width: 16%; }
table.recall th:nth-child(1) { width: 11%; } table.recall th:nth-child(2) { width: 30%; } table.recall th:nth-child(3) { width: 11%; }
table.recall th:nth-child(4) { width: 28%; } table.recall th:nth-child(5) { width: 20%; }
td code { font-size: 8pt; }
.ref { white-space: nowrap; }
.sev { display: inline-block; min-width: 54px; text-align: center; color: #fff; font-size: 8pt; font-weight: 600; border-radius: 3px; padding: 1px 5px; }
.bar { display: flex; height: 18px; border-radius: 3px; overflow: hidden; margin: 4px 0 4px; }
.bar span { display: block; height: 100%; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 9pt; color: var(--muted); margin: 0 0 10px; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
.finding { border-top: 1px solid var(--rule); padding-top: 6px; margin-top: 10px; break-inside: avoid; }
.finding h3 { margin-top: 0; }
.meta { color: var(--muted); font-size: 9pt; }
@page { size: A4; margin: 16mm 14mm 18mm; }
@media print {
  body { max-width: none; padding: 0; }
  h2 { break-after: avoid; }
  h2#scope, h2#findings, h2#appendix, h2#details { break-before: page; }
  tr, .notice, pre { break-inside: avoid; }
  a { text-decoration: none; }
}
`

/**
 * Renders the blocks as one self-contained, print-ready HTML page, links pointing at the published branch.
 * @param {object[]} list the blocks
 * @returns {string} the HTML
 */
function toHtml(list) {
  const title = list.find(block => block.type === 'title')
  const text = runs => runs.map(run => (run?.sev !== undefined ? `<span class="sev" style="background:${SEVERITY_COLOR[run.sev]}">${capital(run.sev)}</span>` : inline([run], 'html', ''))).join('')
  const body = []
  for (const block of list) {
    if (block.type === 'title') body.push(`<h1>${escapeHtml(block.text)}</h1>`, `<p class="sub">${escapeHtml(block.sub)}</p>`)
    else if (block.type === 'notice') body.push(`<div class="notice ${block.kind}">${text(block.runs)}</div>`)
    else if (block.type === 'h') body.push(`<h${block.level} id="${block.id}">${escapeHtml(block.text)}</h${block.level}>`)
    else if (block.type === 'p') body.push(`<p>${text(block.runs)}</p>`)
    else if (block.type === 'list') body.push(`<ul>${block.items.map(item => `<li>${text(item)}</li>`).join('')}</ul>`)
    else if (block.type === 'bar') {
      const present = SEVERITIES.filter(severity => (block.counts[severity] ?? 0) > 0)
      body.push(`<div class="bar" role="img" aria-label="${escapeHtml(SEVERITIES.map(severity => `${block.counts[severity] ?? 0} ${severity}`).join(', '))}">${present.map(severity => `<span style="width:${((block.counts[severity] / block.total) * 100).toFixed(2)}%;background:${SEVERITY_COLOR[severity]}"></span>`).join('')}</div>`)
      body.push(`<div class="legend">${SEVERITIES.map(severity => `<span><i style="background:${SEVERITY_COLOR[severity]}"></i>${capital(severity)} ${block.counts[severity] ?? 0}</span>`).join('')}<span>Total ${block.total}</span></div>`)
    }
    else if (block.type === 'table') body.push(`<table class="${block.className}"><thead><tr>${block.head.map(head => `<th>${escapeHtml(head)}</th>`).join('')}</tr></thead><tbody>${block.rows.map(row => `<tr>${row.map(value => `<td>${text(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
    else if (block.type === 'code') body.push(`<pre>${escapeHtml(block.text)}</pre>`)
    else if (block.type === 'finding') {
      const f = block.finding
      const where = block.seeded ? (f.canary === undefined ? 'not a planted site' : `planted defect ${f.canary}`) : (f.issues.length > 0 ? `documented issue ${f.issues.join(', ')}` : 'beyond the documented list, untriaged')
      body.push(`<section class="finding" id="${f.ref}"><h3>${escapeHtml(f.ref)}. <span class="sev" style="background:${SEVERITY_COLOR[f.severity]}">${capital(f.severity)}</span> ${htmlText(f.title)}</h3>`
        + `<p class="meta"><code>${escapeHtml(`${f.file}:${f.line}`)}</code> · ${escapeHtml(f.cwe)}${f.owasp === undefined ? '' : ` · ${escapeHtml(f.owasp)}`} · department confidence ${escapeHtml(f.confidence)} · ${escapeHtml(where)}</p>`
        + `<pre>${escapeHtml(f.snippet)}</pre>`
        + `<p><strong>Evidence.</strong> ${htmlText(f.evidence)}</p><p><strong>Impact.</strong> ${htmlText(f.impact)}</p><p><strong>Fix.</strong> ${htmlText(f.fix)}</p></section>`)
    }
  }
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(title.text)}</title>\n<style>${CSS}</style>\n</head>\n<body>\n${body.join('\n')}\n</body>\n</html>\n`
}

/**
 * Renders a record's assessment.
 * @param {string} recordDir the record directory
 * @returns {{ dir: string, markdown: string, html: string }} the report directory and both renderings
 */
export function renderAssessment(recordDir) {
  const assessment = readAssessment(recordDir)
  const list = blocks(assessment)
  return { dir: join(REPORTS_DIR, assessment.name), markdown: toMarkdown(list, assessment.reportPath), html: toHtml(list) }
}

/**
 * Prints an HTML file to a PDF through playwright-core's Chromium.
 * @param {string} htmlPath the HTML file
 * @param {string} pdfPath the PDF to write
 * @returns {Promise<void>} settles once the PDF is written
 */
async function printPdf(htmlPath, pdfPath) {
  const { chromium } = await import(process.env.PLAYWRIGHT_CORE === undefined ? 'playwright-core' : pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href)
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM === undefined ? {} : { executablePath: process.env.PLAYWRIGHT_CHROMIUM })
  try {
    const page = await browser.newPage()
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' })
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: '<div style="width:100%;font-size:8px;color:#4b5563;padding:0 14mm;display:flex;justify-content:space-between"><span class="title"></span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
    })
  } finally {
    await browser.close()
  }
}

async function main() {
  const args = process.argv.slice(2)
  const pdfIndex = args.indexOf('--pdf')
  const pdfPath = pdfIndex === -1 ? undefined : args[pdfIndex + 1]
  if (pdfIndex !== -1 && pdfPath === undefined) {
    console.error('usage: node client-report.mjs [<record dir>] [--check | --print] [--pdf <file>]')
    process.exit(2)
  }
  const positional = args.filter((arg, index) => !arg.startsWith('--') && (pdfIndex === -1 || index !== pdfIndex + 1))
  const recordDir = positional[0] === undefined ? latestRecord('nodegoat') : resolve(positional[0])
  const { dir, markdown, html } = renderAssessment(recordDir)
  const files = [[join(dir, MD_NAME), markdown], [join(dir, HTML_NAME), html]]
  if (args.includes('--print')) {
    process.stdout.write(markdown)
    return
  }
  if (args.includes('--check')) {
    const stale = files.filter(([path, content]) => !existsSync(path) || readFileSync(path, 'utf8') !== content).map(([path]) => repoPath(path))
    if (stale.length > 0) {
      console.error(`client-report: ${stale.join(' and ')} differ from the rendering of ${repoPath(recordDir)}; run node data/code-safety/tools/client-report.mjs ${repoPath(recordDir)}`)
      process.exit(1)
    }
    console.log(`client-report: ${repoPath(dir)} matches ${repoPath(recordDir)}`)
    return
  }
  mkdirSync(dir, { recursive: true })
  for (const [path, content] of files) writeFileSync(path, content)
  console.log(`client-report: wrote ${files.map(([path]) => repoPath(path)).join(' and ')} from ${repoPath(recordDir)}`)
  if (pdfPath !== undefined) {
    await printPdf(join(dir, HTML_NAME), resolve(pdfPath))
    console.log(`client-report: printed ${pdfPath}`)
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
