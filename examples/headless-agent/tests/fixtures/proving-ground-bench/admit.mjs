#!/usr/bin/env node
/**
 * Admission of the bench's environments: for every `environments/<task>/`,
 * the fixture as shipped must fail its own tests (the pre-state), the hidden
 * reference must pass them, no `node_modules` may exist, and `task.json` must
 * carry the fields the registrar reads.
 *
 * A task whose check names a case file under `reference/` is admitted only when
 * that file also discriminates: every case must reproduce against the reference
 * and at least one must mismatch against the pre-state. Without the second
 * condition a case file would certify a program that was never written.
 *
 * Exits 1 on the first task that fails admission; prints one line per admitted
 * task, carrying the hidden-case count where a task has one.
 *
 *   node admit.mjs [<environments-dir>]
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(process.argv[2] ?? fileURLToPath(new URL('./environments/', import.meta.url)))
const REQUIRED = ['id', 'tier', 'domain', 'title', 'prompt', 'heldOut', 'immutable', 'checks']
/** Channels a case compares when its file names none, matching the registrar. */
const DEFAULT_CHANNELS = ['exit', 'stdout']
/** One case may not outrun the visible suite's own budget. */
const CASE_TIMEOUT_MS = 20_000

function runTests(cwd) {
  return spawnSync('node', ['--test', 'test/*.test.js'], { cwd, encoding: 'utf8', shell: true, timeout: 120_000 })
}

/**
 * The registrar's digest of one expected stream: CRLF folded to LF, then
 * SHA-256. Admission compares candidate streams the same way, so a case that
 * passes here is a case the runner also accepts.
 */
function digest(text) {
  return createHash('sha256').update(Buffer.from(text.replaceAll('\r\n', '\n'), 'utf8')).digest('hex')
}

/** Run one case's command in `cwd` and report the channels that disagree with it. */
function caseMismatches(cwd, command, entry) {
  const channels = entry.channels ?? DEFAULT_CHANNELS
  const run = spawnSync('node', [...command, ...entry.argv], {
    cwd,
    encoding: 'utf8',
    input: entry.stdin ?? '',
    timeout: CASE_TIMEOUT_MS,
  })
  const mismatched = []
  if (channels.includes('exit') && run.status !== entry.exitCode) mismatched.push('exit')
  if (channels.includes('stdout') && digest(run.stdout ?? '') !== digest(entry.stdout)) mismatched.push('stdout')
  if (channels.includes('stderr') && digest(run.stderr ?? '') !== digest(entry.stderr ?? '')) mismatched.push('stderr')
  return mismatched
}

/**
 * The command a cased check runs, as `node` argv. A bench case file belongs to
 * a check whose `run` invokes node on a script under `src/`; admission runs the
 * same script directly so it needs no shell.
 */
function caseCommand(check) {
  const words = check.run.split(/\s+/u).filter(word => word !== '')
  if (words[0] !== 'node') return undefined
  return words.slice(1)
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
  const cased = task.checks.filter(check => typeof check.cases === 'string')
  let caseCount = 0
  const copy = mkdtempSync(join(tmpdir(), `admit-${name}-`))
  try {
    cpSync(dir, copy, { recursive: true })
    rmSync(join(copy, 'reference'), { recursive: true, force: true })
    const pre = runTests(copy)
    if (pre.status === 0) problems.push('pre-state passes its tests')
    for (const check of cased) {
      const relative = check.cases
      if (!relative.startsWith('reference/')) {
        problems.push(`check ${check.id} names cases outside reference/: ${relative}`)
        continue
      }
      const command = caseCommand(check)
      if (command === undefined) {
        problems.push(`check ${check.id} carries cases but its run "${check.run}" does not invoke node`)
        continue
      }
      const entries = JSON.parse(readFileSync(join(dir, ...relative.split('/')), 'utf8'))
      if (!Array.isArray(entries) || entries.length === 0) {
        problems.push(`check ${check.id} cases ${relative} is not a non-empty array`)
        continue
      }
      caseCount += entries.length
      const ids = new Set()
      for (const entry of entries) {
        if (ids.has(entry.id)) problems.push(`check ${check.id} repeats case id ${entry.id}`)
        ids.add(entry.id)
        if (!Number.isSafeInteger(entry.weight) || entry.weight < 1) problems.push(`check ${check.id} case ${entry.id} has weight ${entry.weight}`)
      }
      // The pre-state still stands in the copy: a case file that it satisfies
      // in full measures nothing the visible suite does not already measure.
      const discriminating = entries.some(entry => caseMismatches(copy, command, entry).length > 0)
      if (!discriminating) problems.push(`check ${check.id} cases ${relative}: the pre-state passes every case`)
    }
    rmSync(join(copy, 'src'), { recursive: true, force: true })
    cpSync(join(dir, 'reference', 'src'), join(copy, 'src'), { recursive: true })
    const ref = runTests(copy)
    if (ref.status !== 0) problems.push(`reference fails its tests: ${(ref.stdout + ref.stderr).split('\n').filter(line => /not ok|Error/.test(line)).slice(0, 3).join(' | ')}`)
    for (const check of cased) {
      const command = caseCommand(check)
      if (command === undefined) continue
      const entries = JSON.parse(readFileSync(join(dir, ...check.cases.split('/')), 'utf8'))
      const broken = entries
        .map(entry => ({ id: entry.id, mismatched: caseMismatches(copy, command, entry) }))
        .filter(one => one.mismatched.length > 0)
      if (broken.length > 0) {
        problems.push(`check ${check.id}: the reference misses ${broken.length} of ${entries.length} cases (${broken.slice(0, 3).map(one => `${one.id}:${one.mismatched.join('+')}`).join(', ')})`)
      }
    }
  } finally {
    rmSync(copy, { recursive: true, force: true })
  }
  if (problems.length > 0) {
    failures += 1
    console.error(`REJECT ${name}: ${problems.join('; ')}`)
  } else {
    const cases = caseCount > 0 ? ` cases=${caseCount}` : ''
    console.log(`admit ${task.id} tier=${task.tier} domain=${task.domain} heldOut=${task.heldOut}${cases}`)
  }
}
if (failures > 0) {
  console.error(`admit: ${failures} task(s) rejected`)
  process.exit(1)
}
