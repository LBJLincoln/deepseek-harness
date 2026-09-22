#!/usr/bin/env node
/** The command: `html`, `outline` and `defs`, each over the document on standard input. */

import { existsSync, readFileSync } from 'node:fs'
import { BlockError, headings, parse, render, splitLines } from './block.js'
import { define, readDefinition, RefError } from './refs.js'

const USAGE = 'usage: cli.js html|outline|defs [<definitions>]'

/** Report one failure the way the specification words it, and stop. */
function fail(message) {
  process.stderr.write(`error: ${message}\n`)
  process.exit(2)
}

/** The definitions one file carries, refused at its own line when a line is not a definition. */
function fileDefinitions(path) {
  if (!existsSync(path)) fail(`cannot read definitions ${path}`)
  const table = new Map()
  for (const [index, raw] of splitLines(readFileSync(path, 'utf8')).entries()) {
    const line = index + 1
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue
    const definition = readDefinition(raw)
    if (definition === undefined) fail(`${path}: line ${line}: expected [label]: <url>`)
    try {
      define(table, line, definition, 'file')
    } catch (error) {
      if (!(error instanceof RefError)) throw error
      fail(`${path}: line ${line}: ${error.message}`)
    }
  }
  return table
}

const argv = process.argv.slice(2)
const mode = argv[0]
if (!['html', 'outline', 'defs'].includes(mode) || argv.length > 2) fail(USAGE)

const definitions = argv.length === 2 ? fileDefinitions(argv[1]) : new Map()

let parsed
try {
  parsed = parse(splitLines(readFileSync(0, 'utf8')), definitions)
} catch (error) {
  if (!(error instanceof BlockError) && !(error instanceof RefError)) throw error
  fail(`line ${error.line}: ${error.message}`)
}

if (mode === 'html') {
  process.stdout.write(render(parsed, definitions))
} else if (mode === 'outline') {
  process.stdout.write(headings(parsed).map(one => `${one.level} ${one.text}\n`).join(''))
} else {
  const out = [...definitions].sort((left, right) => (left[0] < right[0] ? -1 : 1))
  process.stdout.write(`${out.map(([label, { url, source }]) => `${label} ${url} ${source}\n`).join('')}total ${out.length}\n`)
}
