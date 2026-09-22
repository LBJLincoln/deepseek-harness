#!/usr/bin/env node
// Assembles one target's three-tier comparison into a single record: the
// commodity static-analysis floor, a single frontier model in one pass, and
// the enterprise program, each scored against the same ground truth by
// compare.mjs's rule, plus the issue-by-issue matrix and the gaps the
// comparison exposes. The gaps are the improvement loop's input: an issue a
// single pass caught that the departments missed names a department scope to
// widen.
//
// Usage: node assemble-comparison.mjs <ground-truth json> <out dir>
//   reads, from <out dir>: t0-semgrep-findings.json, t1-single-model-findings.json,
//   t1-single-model-meta.json; the enterprise record named in ENTERPRISE_RECORD; and,
//   when present, iterations.json: the improvement-loop iterations run against the
//   enterprise baseline, each naming its record, the change it tested, the issues it
//   targeted, and the decision taken. The proposal and the decision are authored;
//   the reading (recall, issues gained and lost against the baseline, targets caught)
//   is scored here from the record.
// Writes <out dir>/comparison.json.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [groundTruthPath, outDir] = process.argv.slice(2)
if (!groundTruthPath || !outDir) {
  console.error('usage: node assemble-comparison.mjs <ground-truth json> <out dir>')
  process.exit(2)
}
const ENTERPRISE_RECORD = process.env.ENTERPRISE_RECORD ?? 'data/code-safety/2026-09-21-nodegoat-3'
const truth = JSON.parse(readFileSync(groundTruthPath, 'utf8'))
const TOLERANCE = 3
const within = (f, file, lines) => f.file === file && typeof f.line === 'number' && f.line >= lines[0] - TOLERANCE && f.line <= lines[1] + TOLERANCE
const locationsOf = issue => [{ file: issue.file, lines: issue.lines }, ...(issue.alsoAt ?? [])]

/** Score a findings list: which known issues it caught, its recall, and its counts. */
function score(findings) {
  const caught = new Set()
  for (const issue of truth.issues) {
    if (findings.some(f => locationsOf(issue).some(l => within(f, l.file, l.lines)))) caught.add(issue.id)
  }
  const onKnown = findings.filter(f => truth.issues.some(issue => locationsOf(issue).some(l => within(f, l.file, l.lines)))).length
  return { caught, found: caught.size, recall: Number((caught.size / truth.issues.length).toFixed(3)), findings: findings.length, onKnown }
}

const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const asFindings = raw => (Array.isArray(raw) ? raw : raw.findings ?? [])

const semgrep = score(readJson(join(outDir, 't0-semgrep-findings.json')))
const single = score(readJson(join(outDir, 't1-single-model-findings.json')))
const singleMeta = readJson(join(outDir, 't1-single-model-meta.json'))
const enterpriseRecord = readJson(join(ENTERPRISE_RECORD, 'findings.json'))
const enterpriseManifest = readJson(join(ENTERPRISE_RECORD, 'manifest.json'))
const enterprise = score(asFindings(enterpriseRecord))

const matrix = truth.issues.map(issue => ({
  id: issue.id,
  category: issue.category,
  cwe: issue.cwe,
  semgrep: semgrep.caught.has(issue.id),
  singleModel: single.caught.has(issue.id),
  enterprise: enterprise.caught.has(issue.id),
}))
const only = (a, b, c) => matrix.filter(m => m[a] && !m[b] && !m[c]).map(m => m.id)
const bothMiss = matrix.filter(m => !m.singleModel && !m.enterprise).map(m => m.id)
/** Drop the internal caught-set before a tier goes into the record; it does not serialize to JSON usefully. */
const tierFields = ({ caught: _caught, ...rest }) => rest

const iterationsPath = join(outDir, 'iterations.json')
const iterations = (existsSync(iterationsPath) ? readJson(iterationsPath) : []).map((iteration) => {
  const scored = score(asFindings(readJson(join(iteration.record, 'findings.json'))))
  const manifest = readJson(join(iteration.record, 'manifest.json'))
  const ids = truth.issues.map(issue => issue.id)
  return {
    ...iteration,
    ...tierFields(scored),
    verified: manifest.verifier?.exitCode === 0,
    wall: `${manifest.elapsedSeconds} s`,
    gained: ids.filter(id => scored.caught.has(id) && !enterprise.caught.has(id)),
    lost: ids.filter(id => enterprise.caught.has(id) && !scored.caught.has(id)),
    targetsCaught: iteration.targets.filter(id => scored.caught.has(id)),
  }
})

const comparison = {
  target: truth.target,
  revision: truth.revision,
  knownIssues: truth.issues.length,
  date: new Date().toISOString().slice(0, 10),
  note: 'Same target, same revision, same 18-issue ground truth, scored by the same rule (a finding within three lines of a known issue). The single-model and enterprise tiers run the same model (sonnet); the only difference between them is the harness. The issue count and locations were never disclosed to any tier.',
  tiers: [
    { id: 'semgrep', name: 'Semgrep, community rules', kind: 'commodity static analysis, no model', ...tierFields(semgrep), verified: false, wall: 'seconds', cost: '$0', detail: '96 rules over 44 files' },
    { id: 'single-model', name: 'One frontier model, one pass', kind: 'a single sonnet session, no departments, no verifier', ...tierFields(single), verified: false, wall: `${Math.round(singleMeta.duration_ms / 1000)} s`, cost: `$${singleMeta.cost_usd.toFixed(2)}`, detail: `${singleMeta.num_turns} turns` },
    { id: 'enterprise', name: 'Daliesk enterprise', kind: 'six departments, a verifier, and integration; same sonnet', ...tierFields(enterprise), verified: enterpriseManifest.verifier?.exitCode === 0, wall: `${enterpriseManifest.elapsedSeconds} s`, cost: 'subscription', detail: `${enterpriseManifest.certified.length} certified; record ${ENTERPRISE_RECORD.split('/').pop()}` },
  ],
  matrix: matrix.map(({ id, category, semgrep: s, singleModel: m, enterprise: e }) => ({ id, category, semgrep: s, singleModel: m, enterprise: e })),
  bothModelsMiss: bothMiss,
  singleModelOnly: only('singleModel', 'semgrep', 'enterprise'),
  enterpriseOnly: only('enterprise', 'semgrep', 'singleModel'),
  iterations,
}

writeFileSync(join(outDir, 'comparison.json'), JSON.stringify(comparison, null, 2))
console.log(`comparison.json: semgrep ${semgrep.found}/${truth.issues.length}, single-model ${single.found}/${truth.issues.length}, enterprise ${enterprise.found}/${truth.issues.length} (verified)`)
console.log(`single-model only: ${comparison.singleModelOnly.join(', ') || 'none'}; enterprise only: ${comparison.enterpriseOnly.join(', ') || 'none'}; both miss: ${bothMiss.join(', ') || 'none'}`)
for (const iteration of iterations) {
  console.log(`iteration ${iteration.id}: ${iteration.found}/${truth.issues.length}; gained ${iteration.gained.join(', ') || 'none'}; lost ${iteration.lost.join(', ') || 'none'}; targets caught ${iteration.targetsCaught.join(', ') || 'none'} of ${iteration.targets.join(', ')}`)
}
