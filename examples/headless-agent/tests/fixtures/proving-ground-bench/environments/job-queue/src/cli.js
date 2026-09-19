#!/usr/bin/env node
/** The command: `trace` and `summary`, each over the log on standard input. */

import { readFileSync } from 'node:fs'
import { LogError, parse, splitLines } from './parse.js'
import { run } from './queue.js'

const USAGE = 'usage: cli.js trace|summary'

/** Report one failure the way the specification words it, and stop. */
function fail(message) {
  process.stderr.write(`error: ${message}\n`)
  process.exit(2)
}

const argv = process.argv.slice(2)
const mode = argv[0]
if (!['trace', 'summary'].includes(mode) || argv.length !== 1) fail(USAGE)

const policy = {}
let parsed
try {
  parsed = parse(splitLines(readFileSync(0, 'utf8')), policy)
} catch (error) {
  if (!(error instanceof LogError)) throw error
  fail(error.line === 0 ? error.message : `line ${error.line}: ${error.message}`)
}

const { attempts, end } = run(parsed.jobs, parsed.submissions, policy)
const out = []
if (mode === 'trace') {
  for (const one of attempts) out.push(`${one.start} ${one.id} attempt=${one.attempt} ${one.outcome} finish=${one.finish}`)
} else {
  for (const { id } of [...parsed.submissions].sort((left, right) => (left.id < right.id ? -1 : 1))) {
    const own = attempts.filter(one => one.id === id)
    out.push(`${id} attempts=${own.length} ${own[own.length - 1].outcome}`)
  }
}
out.push(`end ${end}`)
process.stdout.write(out.map(line => `${line}\n`).join(''))
