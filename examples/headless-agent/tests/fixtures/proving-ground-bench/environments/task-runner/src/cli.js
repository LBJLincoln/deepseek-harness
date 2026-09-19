#!/usr/bin/env node
/** The command: `order`, `show <name>` and `digest <path>...`. */

import { existsSync, readFileSync } from 'node:fs'
import { digestBytes } from './digest.js'
import { order } from './graph.js'
import { parse, ParseError, splitLines } from './parse.js'

const USAGE = 'usage: cli.js order|show <name>|digest <path>...'

/** Report one failure the way the specification words it, and stop. */
function fail(message, code = 2) {
  process.stderr.write(`error: ${message}\n`)
  process.exit(code)
}

/** One `show` field, with `-` standing for an empty list. */
function field(label, values) {
  return `${label}: ${values.length === 0 ? '-' : [...values].sort().join(' ')}`
}

const argv = process.argv.slice(2)
const mode = argv[0]
const arity = { order: 1, show: 2 }
if (mode === 'digest' ? argv.length < 2 : argv.length !== arity[mode]) fail(USAGE)

let tasks
try {
  tasks = parse(splitLines(readFileSync(0, 'utf8')))
} catch (error) {
  if (!(error instanceof ParseError)) throw error
  fail(error.line === 0 ? error.message : `line ${error.line}: ${error.message}`)
}

const out = []
if (mode === 'order') {
  for (const name of order(tasks)) out.push(name)
} else if (mode === 'show') {
  const task = tasks.get(argv[1])
  if (task === undefined) fail(`unknown task ${argv[1]}`)
  out.push(`${task.name}: ${task.command}`)
  out.push(field('needs', task.needs))
} else {
  for (const path of argv.slice(1)) {
    out.push(`${path} ${existsSync(path) ? digestBytes(readFileSync(path)) : 'missing'}`)
  }
}
process.stdout.write(out.map(line => `${line}\n`).join(''))
