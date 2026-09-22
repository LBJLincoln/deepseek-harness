#!/usr/bin/env node
/** The command: `order`, `show <name>`, `files <name>`, `digest <path>...` and `plan <snapshot>`. */

import { existsSync, readFileSync } from 'node:fs'
import { digestBytes } from './digest.js'
import { CycleError, order } from './graph.js'
import { parse, ParseError, splitLines } from './parse.js'
import { plan, readSnapshot, SnapshotError } from './plan.js'

const USAGE = 'usage: cli.js order|show <name>|files <name>|digest <path>...|plan <snapshot>'

/** Report one failure the way the specification words it, and stop. */
function fail(message, code = 2) {
  process.stderr.write(`error: ${message}\n`)
  process.exit(code)
}

/** One `files` field, with `-` standing for an empty list. */
function field(label, values) {
  return `${label}: ${values.length === 0 ? '-' : [...values].sort().join(' ')}`
}

const argv = process.argv.slice(2)
const mode = argv[0]
const arity = { order: 1, show: 2, files: 2, plan: 2 }
if (mode === 'digest' ? argv.length < 2 : argv.length !== arity[mode]) fail(USAGE)

let tasks
try {
  tasks = parse(splitLines(readFileSync(0, 'utf8')))
} catch (error) {
  if (!(error instanceof ParseError)) throw error
  fail(error.line === 0 ? error.message : `line ${error.line}: ${error.message}`)
}

/** The named task, or the failure that names it. */
function named(name) {
  const task = tasks.get(name)
  if (task === undefined) fail(`unknown task ${name}`)
  return task
}

const out = []
try {
  if (mode === 'order') {
    for (const name of order(tasks)) out.push(name)
  } else if (mode === 'show') {
    const task = named(argv[1])
    out.push(`${task.name}: ${task.command}`)
    out.push(field('needs', task.needs))
  } else if (mode === 'files') {
    const task = named(argv[1])
    out.push(field('reads', task.reads))
    out.push(field('writes', task.writes))
  } else if (mode === 'digest') {
    for (const path of argv.slice(1)) {
      out.push(`${path} ${existsSync(path) ? digestBytes(readFileSync(path)) : 'missing'}`)
    }
  } else {
    const decisions = plan(tasks, readSnapshot(argv[1]))
    for (const { name, reason } of decisions) out.push(reason === undefined ? `skip ${name}` : `run ${name} ${reason}`)
    const running = decisions.filter(decision => decision.reason !== undefined).length
    out.push(`total run=${running} skip=${decisions.length - running}`)
  }
} catch (error) {
  if (error instanceof CycleError) fail(error.message, 3)
  if (error instanceof SnapshotError) fail(error.message)
  throw error
}
process.stdout.write(out.map(line => `${line}\n`).join(''))
