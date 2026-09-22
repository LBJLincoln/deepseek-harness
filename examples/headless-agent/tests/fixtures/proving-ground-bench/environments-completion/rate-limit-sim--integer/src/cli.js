#!/usr/bin/env node
/** The command: `replay` verdicts every event, `summary` totals them per key. */

import { readFileSync } from 'node:fs'
import { LimitError, parse, replay } from './replay.js'

/** Report one failure the way the specification words it, and stop. */
function fail(message) {
  process.stderr.write(`error: ${message}\n`)
  process.exit(2)
}

/** Every input line, with the trailing newline's empty tail dropped. */
function lines() {
  const split = readFileSync(0, 'utf8').split('\n')
  if (split.length > 0 && split[split.length - 1] === '') split.pop()
  return split
}

const argv = process.argv.slice(2)
if (argv.length !== 1 || (argv[0] !== 'replay' && argv[0] !== 'summary')) fail('usage: cli.js replay|summary')

let parsed
try {
  parsed = parse(lines())
} catch (error) {
  if (!(error instanceof LimitError)) throw error
  fail(`line ${error.line}: ${error.message}`)
}

const verdicts = replay(parsed.routes, parsed.events)
const out = []
if (argv[0] === 'replay') {
  for (const verdict of verdicts) {
    out.push(`${verdict.tick} ${verdict.key} ${verdict.allowed ? 'allow' : `deny ${verdict.by}`}`)
  }
} else {
  const keys = [...new Set(verdicts.map(verdict => verdict.key))].sort()
  for (const key of keys) {
    const own = verdicts.filter(verdict => verdict.key === key)
    out.push(`${key} allowed=${own.filter(verdict => verdict.allowed).length} denied=${own.filter(verdict => !verdict.allowed).length}`)
  }
  out.push(`total allowed=${verdicts.filter(verdict => verdict.allowed).length} denied=${verdicts.filter(verdict => !verdict.allowed).length}`)
}
process.stdout.write(out.map(line => `${line}\n`).join(''))
