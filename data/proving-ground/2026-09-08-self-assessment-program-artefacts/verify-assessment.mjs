#!/usr/bin/env node
// Mechanical verifier for assessment.md: structure, verdict lines, citations
// that resolve to files under evidence/, and bounds. Exit 0 when every rule
// holds; otherwise print each failure and exit 1.
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

const path = process.argv[2] ?? 'assessment.md'
const failures = []
if (!existsSync(path)) {
  console.error(`missing ${path}`)
  process.exit(1)
}
const text = readFileSync(path, 'utf8')
const root = dirname(path) === '.' ? process.cwd() : dirname(path)
const sections = ['## Verdict', '## Evidence', '## What the evidence does not support', '## What would change the verdict']
const positions = sections.map(s => text.indexOf(`\n${s}\n`) === -1 && !text.startsWith(`${s}\n`) ? -1 : (text.startsWith(`${s}\n`) ? 0 : text.indexOf(`\n${s}\n`)))
sections.forEach((s, i) => { if (positions[i] === -1) failures.push(`section missing: ${s}`) })
for (let i = 1; i < positions.length; i++) {
  if (positions[i] !== -1 && positions[i - 1] !== -1 && positions[i] < positions[i - 1]) failures.push(`section out of order: ${sections[i]}`)
}
const body = (name) => {
  const i = sections.indexOf(name)
  if (positions[i] === -1) return ''
  const start = positions[i] + name.length + 1
  const next = positions.slice(i + 1).filter(p => p !== -1).sort((a, b) => a - b)[0]
  return text.slice(start, next === undefined ? text.length : next)
}
const verdict = body('## Verdict')
if (!/^Viable: (yes|no|undetermined) \((high|medium|low) confidence\)/m.test(verdict)) failures.push('verdict line missing: "Viable: yes|no|undetermined (high|medium|low confidence)"')
if (!/^State of the art: (yes|no|in part|undetermined) \((high|medium|low) confidence\)/m.test(verdict)) failures.push('verdict line missing: "State of the art: yes|no|in part|undetermined (high|medium|low confidence)"')
const bullets = (s) => s.split('\n').filter(l => /^\s*[-*] /.test(l))
const evidenceBullets = bullets(body('## Evidence'))
if (evidenceBullets.length < 8) failures.push(`evidence needs at least 8 bullets, found ${evidenceBullets.length}`)
const cited = new Set()
for (const line of evidenceBullets) {
  const refs = [...line.matchAll(/evidence\/([A-Za-z0-9._-]+)/g)].map(m => m[1])
  if (refs.length === 0) failures.push(`evidence bullet without a citation: ${line.trim().slice(0, 80)}`)
  for (const ref of refs) {
    if (!existsSync(join(root, 'evidence', ref))) failures.push(`citation does not resolve: evidence/${ref}`)
    else cited.add(ref)
  }
}
if (cited.size < 6) failures.push(`at least 6 distinct evidence files must be cited, found ${cited.size}`)
if (bullets(body('## What the evidence does not support')).length < 3) failures.push('"What the evidence does not support" needs at least 3 bullets')
if (bullets(body('## What would change the verdict')).length < 3) failures.push('"What would change the verdict" needs at least 3 bullets')
const words = text.split(/\s+/).filter(Boolean).length
if (words < 600 || words > 2500) failures.push(`length must be 600 to 2500 words, found ${words}`)
if (/TODO|TBD|lorem/i.test(text)) failures.push('placeholder text present')
if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL ${f}`)
  process.exit(1)
}
console.log(`ok: ${evidenceBullets.length} evidence bullets, ${cited.size} files cited, ${words} words`)
