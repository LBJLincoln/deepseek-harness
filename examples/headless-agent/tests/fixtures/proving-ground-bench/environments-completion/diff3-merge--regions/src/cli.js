#!/usr/bin/env node
/** The command: merge three documents, with or without the base section, or report the regions. */

import { readFileSync } from 'node:fs'
import { describe, regions, render } from './merge.js'

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
const mode = argv[0]
if (argv.length !== 1 || (mode !== 'merge' && mode !== 'merge2' && mode !== 'regions')) fail('usage: cli.js merge|merge2|regions')

const parts = [[]]
for (const line of lines()) {
  if (line === '%%%') parts.push([])
  else parts[parts.length - 1].push(line)
}
if (parts.length !== 3) fail('expected three parts separated by %%%')

const found = regions(parts[0], parts[1], parts[2])
const out = mode === 'regions' ? describe(found) : render(found, mode === 'merge')
process.stdout.write(out.map(line => `${line}\n`).join(''))
process.exit(found.some(region => region.kind === 'conflict') ? 1 : 0)
