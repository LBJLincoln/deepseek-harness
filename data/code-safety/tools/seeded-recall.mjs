#!/usr/bin/env node
// Scores a findings list (a plain JSON file, a record-run.mjs record
// directory, or a raw `pnpm run code-safety --out <dir>` run directory)
// against a seeded ground truth from seed-defects.mjs, using the same match
// rule as compare.mjs and recall.mjs: a known issue counts as found when a
// finding cites the issue's file within three lines of its range, or one of
// its `alsoAt` locations. Prints caught/N overall and per class (CWE), each
// with a Wilson 95% confidence interval, since the seeded count is small
// enough that a plain fraction overstates precision. The result is recall on
// the seeded classes at the seeded sites, not the base rate of real defects in
// the target; data/code-safety/README.md#recall-without-a-ground-truth-seeded-defects
// states what the number means and does not.
//
// Usage: node seeded-recall.mjs <findings json | record dir | raw run dir> <seeded ground truth json> [--json]
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** compare.mjs's and recall.mjs's tolerance: lines of margin around a listed range. */
const TOLERANCE = 3
/** The two-sided 95% normal quantile, for the Wilson score interval. */
const Z_95 = 1.959963985

/**
 * Reads the findings a run released, from a plain findings JSON file, a
 * `record-run.mjs` record directory's `findings.json`, or a raw
 * `pnpm run code-safety --out <dir>` run directory's `stdout.jsonl` (its last
 * line's `findings` field, before any record exists) — so scoring a seeded
 * copy's review never requires recording it into `data/code-safety/`, which
 * `record-run.mjs` always writes under regardless of the target.
 * @param {string} path a findings JSON file, or a record or raw run directory
 * @returns {object[]} the findings array (`id`, `file`, `line`, `cwe`, …)
 */
export function loadFindings(path) {
  if (statSync(path).isDirectory()) {
    if (existsSync(join(path, 'findings.json'))) return loadFindings(join(path, 'findings.json'))
    if (existsSync(join(path, 'stdout.jsonl'))) {
      const lastLine = readFileSync(join(path, 'stdout.jsonl'), 'utf8').trim().split('\n').at(-1)
      const result = JSON.parse(lastLine)
      return result.findings === '' || result.findings === undefined ? [] : JSON.parse(result.findings)
    }
    throw new Error(`${path} holds neither findings.json nor stdout.jsonl`)
  }
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  return Array.isArray(raw) ? raw : raw.findings ?? []
}

/**
 * Whether a finding lands within `TOLERANCE` lines of a location.
 * @param {{ file: string, line: number }} finding a released finding
 * @param {string} file the location's file
 * @param {[number, number]} lines the location's inclusive line range
 * @returns {boolean} true when the finding counts as catching that location
 */
function within(finding, file, lines) {
  return finding.file === file && typeof finding.line === 'number' && finding.line >= lines[0] - TOLERANCE && finding.line <= lines[1] + TOLERANCE
}

/**
 * The Wilson score interval for a binomial proportion, which stays inside
 * [0, 1] and does not collapse to a zero-width interval at k = 0 or k = n the
 * way a normal-approximation interval does — the right choice for the small
 * counts one seeding run produces.
 * @param {number} k successes (issues caught)
 * @param {number} n trials (seeded issues)
 * @param {number} [z] the two-sided normal quantile; defaults to 95%
 * @returns {{ low: number, high: number }} the interval, rounded to 3 decimals
 */
export function wilsonInterval(k, n, z = Z_95) {
  if (n === 0) return { low: 0, high: 0 }
  const phat = k / n
  const z2 = z * z
  const denominator = 1 + z2 / n
  const center = (phat + z2 / (2 * n)) / denominator
  const margin = (z * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n))) / denominator
  return { low: Number(Math.max(0, center - margin).toFixed(3)), high: Number(Math.min(1, center + margin).toFixed(3)) }
}

/**
 * Scores a findings list against a seeded ground truth.
 * @param {object[]} findings released findings (`file`, `line`, …)
 * @param {{ target: string, revision: string, issues: object[] }} truth a `seed-defects.mjs` ground truth
 * @returns {{ target: string, revision: string, n: number, caught: number, recall: number, interval: { low: number, high: number }, rows: object[], byClass: object[] }} the overall and per-class reading
 */
export function score(findings, truth) {
  const rows = truth.issues.map(issue => {
    const locations = [{ file: issue.file, lines: issue.lines }, ...(issue.alsoAt ?? [])]
    const matched = findings.filter(f => locations.some(l => within(f, l.file, l.lines)))
    return { id: issue.id, category: issue.category, cwe: issue.cwe, file: `${issue.file}:${issue.lines.join('-')}`, found: matched.length > 0, by: matched.map(f => `${f.id ?? '?'}@${f.file}:${f.line}`) }
  })
  const caught = rows.filter(row => row.found).length
  const byCwe = new Map()
  for (const row of rows) {
    const bucket = byCwe.get(row.cwe) ?? { cwe: row.cwe, category: row.category, n: 0, caught: 0 }
    bucket.n += 1
    if (row.found) bucket.caught += 1
    byCwe.set(row.cwe, bucket)
  }
  const byClass = [...byCwe.values()]
    .sort((a, b) => a.cwe.localeCompare(b.cwe))
    .map(bucket => ({ ...bucket, recall: Number((bucket.caught / bucket.n).toFixed(3)), interval: wilsonInterval(bucket.caught, bucket.n) }))
  return {
    target: truth.target,
    revision: truth.revision,
    n: rows.length,
    caught,
    recall: Number((caught / rows.length).toFixed(3)),
    interval: wilsonInterval(caught, rows.length),
    rows,
    byClass,
  }
}

function main() {
  const [findingsPath, groundTruthPath, ...flags] = process.argv.slice(2)
  if (findingsPath === undefined || groundTruthPath === undefined || !existsSync(findingsPath) || !existsSync(groundTruthPath)) {
    console.error('usage: node seeded-recall.mjs <findings json | record dir | raw run dir> <seeded ground truth json> [--json]')
    process.exit(2)
  }
  const asJson = flags.includes('--json')
  const findings = loadFindings(findingsPath)
  const truth = JSON.parse(readFileSync(groundTruthPath, 'utf8'))
  const result = score(findings, truth)

  if (asJson) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  for (const row of result.rows) console.log(`${row.found ? 'caught' : 'missed'}  ${row.id.padEnd(9)} ${row.cwe.padEnd(10)} ${row.file}`)
  console.log('')
  console.log(`seeded recall ${result.caught}/${result.n} (${result.recall}), 95% CI [${result.interval.low}, ${result.interval.high}] on ${result.target} at ${result.revision.slice(0, 7)}`)
  console.log('by class:')
  for (const bucket of result.byClass) {
    console.log(`  ${bucket.cwe.padEnd(10)} ${bucket.caught}/${bucket.n} (${bucket.recall}), 95% CI [${bucket.interval.low}, ${bucket.interval.high}]  ${bucket.category}`)
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main()
