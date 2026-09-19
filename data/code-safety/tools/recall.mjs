#!/usr/bin/env node
// Reads a code-safety record's recall against a target's ground-truth list:
// a known issue counts as found when a released finding cites the issue's file
// within three lines of its range, or one of the issue's `alsoAt` locations
// (other lines where the same defect is visible, listed with the ground truth).
// Prints one line per known issue and the recall, plus the findings the ground
// truth does not list. Never part of the release gate.
//
// Usage: node recall.mjs <record dir> <ground-truth json> [--json]
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const [recordDir, groundTruthPath, ...flags] = process.argv.slice(2)
if (!recordDir || !groundTruthPath) {
  console.error('usage: node recall.mjs <record dir> <ground-truth json> [--json]')
  process.exit(2)
}
const asJson = flags.includes('--json')
const raw = JSON.parse(readFileSync(join(recordDir, 'findings.json'), 'utf8'))
const findings = Array.isArray(raw) ? raw : raw.findings ?? []
const truth = JSON.parse(readFileSync(groundTruthPath, 'utf8'))
const TOLERANCE = 3

const within = (finding, file, lines) => finding.file === file && finding.line >= lines[0] - TOLERANCE && finding.line <= lines[1] + TOLERANCE
const rows = truth.issues.map(issue => {
  const locations = [{ file: issue.file, lines: issue.lines }, ...(issue.alsoAt ?? [])]
  const matched = findings.filter(f => locations.some(l => within(f, l.file, l.lines)))
  return { id: issue.id, category: issue.category, file: `${issue.file}:${issue.lines.join('-')}`, found: matched.length > 0, by: matched.map(f => `${f.id}@${f.file}:${f.line}`) }
})
const found = rows.filter(r => r.found).length
const matchedIds = new Set(rows.flatMap(r => r.by.map(b => b.split('@')[0])))
const beyond = findings.filter(f => !matchedIds.has(f.id))
const summary = { target: truth.target, revision: truth.revision, knownIssues: rows.length, found, recall: Number((found / rows.length).toFixed(3)), findings: findings.length, beyondGroundTruth: beyond.length }

if (asJson) {
  console.log(JSON.stringify({ ...summary, rows, beyond: beyond.map(f => ({ id: f.id, severity: f.severity, cwe: f.cwe, file: f.file, line: f.line, title: f.title })) }, null, 2))
} else {
  for (const r of rows) console.log(`${r.found ? 'found ' : 'missed'}  ${r.id.padEnd(9)} ${r.file.padEnd(40)} ${r.found ? r.by.join(', ') : ''}`)
  console.log(`recall ${found}/${rows.length} on ${truth.target} at ${truth.revision.slice(0, 7)}; ${findings.length} findings released, ${beyond.length} beyond the ground truth`)
}
