#!/usr/bin/env node
/** The command: `trace`, `summary` and `dead`, each over the log on standard input. */

import { readFileSync } from 'node:fs'
import { LogError, parse, splitLines } from './parse.js'
import { PolicyError, readPolicy } from './policy.js'
import { run } from './queue.js'

const USAGE = 'usage: cli.js trace|summary|dead [<policy>]'

/** Report one failure the way the specification words it, and stop. */
function fail(message) {
  process.stderr.write(`error: ${message}\n`)
  process.exit(2)
}

const argv = process.argv.slice(2)
const mode = argv[0]
if (!['trace', 'summary', 'dead'].includes(mode) || argv.length > 2) fail(USAGE)

let policy = {}
if (argv.length === 2) {
  try {
    policy = readPolicy(argv[1])
  } catch (error) {
    if (!(error instanceof PolicyError)) throw error
    fail(error.message)
  }
}

let parsed
try {
  parsed = parse(splitLines(readFileSync(0, 'utf8')), policy)
} catch (error) {
  if (!(error instanceof LogError)) throw error
  fail(error.line === 0 ? error.message : `line ${error.line}: ${error.message}`)
}

const { attempts, dead, end } = run(parsed.jobs, parsed.submissions, policy)
const out = []
if (mode === 'trace') {
  for (const one of attempts) out.push(`${one.start} ${one.id} attempt=${one.attempt} ${one.outcome} finish=${one.finish}`)
  out.push(`end ${end}`)
} else if (mode === 'summary') {
  const written = new Set(dead.map(one => one.id))
  for (const { id } of [...parsed.submissions].sort((left, right) => (left.id < right.id ? -1 : 1))) {
    const own = attempts.filter(one => one.id === id)
    const state = written.has(id) ? 'dead' : own[own.length - 1].outcome
    out.push(`${id} attempts=${own.length} ${state}`)
  }
  out.push(`end ${end}`)
} else {
  for (const one of dead) out.push(`${one.id} attempts=${one.attempts} at=${one.at}`)
  out.push(`total ${dead.length}`)
}
process.stdout.write(out.map(line => `${line}\n`).join(''))
