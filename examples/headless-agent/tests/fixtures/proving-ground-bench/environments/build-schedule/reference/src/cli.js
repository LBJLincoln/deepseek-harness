#!/usr/bin/env node
/** The command: `waves`, `explain`, or `pack <workers>` over a build graph read from standard input. */

import { readFileSync } from 'node:fs'
import { findCycle, GraphError, parse } from './graph.js'
import { explain, pack, span, waves } from './schedule.js'

/** Report one failure the way the specification words it, and stop with `code`. */
function fail(message, code) {
  process.stderr.write(`error: ${message}\n`)
  process.exit(code)
}

/** Every input line, with the trailing newline's empty tail dropped. */
function lines() {
  const split = readFileSync(0, 'utf8').split('\n')
  if (split.length > 0 && split[split.length - 1] === '') split.pop()
  return split
}

const argv = process.argv.slice(2)
const mode = argv[0]
const known = mode === 'waves' || mode === 'explain' || mode === 'pack'
if (!known || argv.length !== (mode === 'pack' ? 2 : 1)) fail('usage: cli.js waves|explain|pack <workers>', 2)
if (mode === 'pack' && !/^[1-9]\d*$/u.test(argv[1])) fail('workers must be a positive integer', 2)

let tasks
try {
  tasks = parse(lines())
} catch (error) {
  if (!(error instanceof GraphError)) throw error
  fail(error.line === 0 ? error.message : `line ${error.line}: ${error.message}`, 2)
}

const cycle = findCycle(tasks)
if (cycle !== undefined) fail(`cycle: ${cycle.join(' -> ')}`, 3)

const out = []
if (mode === 'waves') {
  waves(tasks).forEach((wave, index) => out.push(`wave ${index}: ${wave.join(' ')}`))
  out.push(`total ${span(tasks)}`)
} else if (mode === 'explain') {
  for (const one of explain(tasks)) out.push(`${one.name} start=${one.start} finish=${one.finish} depth=${one.depth}`)
  out.push(`total ${span(tasks)}`)
} else {
  const packed = pack(tasks, Number(argv[1]))
  packed.lanes.forEach((lane, index) => {
    const body = lane.map(one => ` ${one.name}@${one.start}-${one.finish}`).join('')
    out.push(`worker ${index}:${body}`)
  })
  out.push(`makespan ${packed.makespan}`)
}
process.stdout.write(out.map(line => `${line}\n`).join(''))
