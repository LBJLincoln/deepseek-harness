#!/usr/bin/env node
/** The command: `json` prints the canonical document, `keys` its paths and types. */

import { readFileSync } from 'node:fs'
import { parse, toJson, walk } from './document.js'
import { ConfError } from './value.js'

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
if (argv.length !== 1 || (argv[0] !== 'json' && argv[0] !== 'keys')) fail('usage: cli.js json|keys')

let root
try {
  root = parse(lines())
} catch (error) {
  if (!(error instanceof ConfError)) throw error
  fail(`line ${error.line}: ${error.message}`)
}

const out = argv[0] === 'json'
  ? `${JSON.stringify(toJson(root), undefined, 2)}\n`
  : walk(root).map(one => `${one.path} ${one.type}\n`).join('')
process.stdout.write(out)
