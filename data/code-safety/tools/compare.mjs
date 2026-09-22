#!/usr/bin/env node
// Scores one tier of a code-safety comparison against a target's ground truth,
// using the same match rule as recall.mjs: a known issue counts as found when a
// finding cites the issue's file within three lines of its range or one of its
// `alsoAt` locations. A tier is a plain findings list (id, file, line,
// severity, cwe, title) from any producer — a scanner, a single model, or the
// enterprise program — normalized to that schema before it reaches here, so
// every tier is scored identically. Recall is against the 18 known issues;
// precision here is the share of a tier's findings that land on a known issue,
// a floor on real precision because a finding beyond the ground truth may still
// be real (the list is not exhaustive), which the report states.
//
// Usage: node compare.mjs <findings json> <ground-truth json> [--json]
import { readFileSync } from 'node:fs'

const [findingsPath, groundTruthPath, ...flags] = process.argv.slice(2)
if (!findingsPath || !groundTruthPath) {
  console.error('usage: node compare.mjs <findings json> <ground-truth json> [--json]')
  process.exit(2)
}
const asJson = flags.includes('--json')
const raw = JSON.parse(readFileSync(findingsPath, 'utf8'))
const findings = Array.isArray(raw) ? raw : raw.findings ?? []
const truth = JSON.parse(readFileSync(groundTruthPath, 'utf8'))
const TOLERANCE = 3

const within = (finding, file, lines) => finding.file === file && typeof finding.line === 'number' && finding.line >= lines[0] - TOLERANCE && finding.line <= lines[1] + TOLERANCE
const rows = truth.issues.map(issue => {
  const locations = [{ file: issue.file, lines: issue.lines }, ...(issue.alsoAt ?? [])]
  const matched = findings.filter(f => locations.some(l => within(f, l.file, l.lines)))
  return { id: issue.id, category: issue.category, file: `${issue.file}:${issue.lines.join('-')}`, found: matched.length > 0 }
})
const found = rows.filter(r => r.found).length
// A finding lands on a known issue when it matches any issue's location.
const onKnown = findings.filter(f => truth.issues.some(issue => [{ file: issue.file, lines: issue.lines }, ...(issue.alsoAt ?? [])].some(l => within(f, l.file, l.lines)))).length
const summary = {
  target: truth.target,
  revision: truth.revision,
  knownIssues: rows.length,
  found,
  recall: Number((found / rows.length).toFixed(3)),
  findings: findings.length,
  onKnownIssue: onKnown,
  precisionOnKnown: findings.length > 0 ? Number((onKnown / findings.length).toFixed(3)) : 0,
  beyondGroundTruth: findings.length - onKnown,
}

if (asJson) {
  console.log(JSON.stringify({ ...summary, rows }, null, 2))
} else {
  for (const r of rows) console.log(`${r.found ? 'found ' : 'missed'}  ${r.id.padEnd(9)} ${r.file}`)
  console.log(`recall ${found}/${rows.length} (${summary.recall}) on ${truth.target} at ${truth.revision.slice(0, 7)}; ${findings.length} findings, ${onKnown} on a known issue, ${summary.beyondGroundTruth} beyond`)
}
