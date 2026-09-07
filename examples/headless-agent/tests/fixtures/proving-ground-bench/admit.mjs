#!/usr/bin/env node
/**
 * Admission of the bench's environments: for every `environments/<task>/`,
 * the fixture as shipped must fail its own tests (the pre-state), the hidden
 * reference must pass them, no `node_modules` may exist, and `task.json` must
 * carry the fields the registrar reads. Exits 1 on the first task that fails
 * admission; prints one line per admitted task.
 *
 *   node admit.mjs [<environments-dir>]
 */

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(process.argv[2] ?? fileURLToPath(new URL('./environments/', import.meta.url)))
const REQUIRED = ['id', 'tier', 'domain', 'title', 'prompt', 'heldOut', 'immutable', 'checks']

function runTests(cwd) {
  return spawnSync('node', ['--test', 'test/*.test.js'], { cwd, encoding: 'utf8', shell: true, timeout: 120_000 })
}

let failures = 0
for (const name of readdirSync(root).sort()) {
  const dir = join(root, name)
  const taskPath = join(dir, 'task.json')
  if (!existsSync(taskPath)) continue
  const task = JSON.parse(readFileSync(taskPath, 'utf8'))
  const missing = REQUIRED.filter(field => !(field in task))
  const problems = []
  if (missing.length > 0) problems.push(`task.json lacks ${missing.join(', ')}`)
  if (task.id !== `code:${name}`) problems.push(`id ${task.id} does not match directory ${name}`)
  if (existsSync(join(dir, 'node_modules'))) problems.push('node_modules present')
  if (!existsSync(join(dir, 'reference', 'src'))) problems.push('no reference/src')
  const copy = mkdtempSync(join(tmpdir(), `admit-${name}-`))
  try {
    cpSync(dir, copy, { recursive: true })
    rmSync(join(copy, 'reference'), { recursive: true, force: true })
    const pre = runTests(copy)
    if (pre.status === 0) problems.push('pre-state passes its tests')
    rmSync(join(copy, 'src'), { recursive: true, force: true })
    cpSync(join(dir, 'reference', 'src'), join(copy, 'src'), { recursive: true })
    const ref = runTests(copy)
    if (ref.status !== 0) problems.push(`reference fails its tests: ${(ref.stdout + ref.stderr).split('\n').filter(line => /not ok|Error/.test(line)).slice(0, 3).join(' | ')}`)
  } finally {
    rmSync(copy, { recursive: true, force: true })
  }
  if (problems.length > 0) {
    failures += 1
    console.error(`REJECT ${name}: ${problems.join('; ')}`)
  } else {
    console.log(`admit ${task.id} tier=${task.tier} domain=${task.domain} heldOut=${task.heldOut}`)
  }
}
if (failures > 0) {
  console.error(`admit: ${failures} task(s) rejected`)
  process.exit(1)
}
