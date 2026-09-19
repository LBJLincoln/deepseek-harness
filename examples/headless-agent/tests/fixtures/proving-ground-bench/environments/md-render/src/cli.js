#!/usr/bin/env node
/** The command: `html` and `outline`, each over the document on standard input. */

import { readFileSync } from 'node:fs'
import { BlockError, headings, parse, render, splitLines } from './block.js'

const USAGE = 'usage: cli.js html|outline'

/** Report one failure the way the specification words it, and stop. */
function fail(message) {
  process.stderr.write(`error: ${message}\n`)
  process.exit(2)
}

const argv = process.argv.slice(2)
const mode = argv[0]
if (!['html', 'outline'].includes(mode) || argv.length !== 1) fail(USAGE)

let parsed
try {
  parsed = parse(splitLines(readFileSync(0, 'utf8')))
} catch (error) {
  if (!(error instanceof BlockError)) throw error
  fail(`line ${error.line}: ${error.message}`)
}

if (mode === 'html') {
  process.stdout.write(render(parsed))
} else {
  process.stdout.write(headings(parsed).map(one => `${one.level} ${one.text}\n`).join(''))
}
