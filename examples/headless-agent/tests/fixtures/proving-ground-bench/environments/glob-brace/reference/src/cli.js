#!/usr/bin/env node
/** The command: `expand` prints one pattern's expansions, `match` verdicts a list of paths. */

import { readFileSync } from 'node:fs'
import { expandBraces } from './brace.js'
import { GlobError } from './error.js'
import { compile } from './glob.js'

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
if (argv.length !== 1 || (argv[0] !== 'expand' && argv[0] !== 'match')) fail('usage: cli.js expand|match')

const input = lines()
try {
  if (argv[0] === 'expand') {
    if (input.length !== 1) fail('expand needs exactly one pattern line')
    process.stdout.write(expandBraces(input[0]).map(one => `${one}\n`).join(''))
  } else {
    if (input.length === 0) fail('match needs a pattern line')
    const matchers = expandBraces(input[0]).map(compile)
    const out = input.slice(1).map(path => `${matchers.some(matcher => matcher(path)) ? '+' : '-'} ${path}\n`)
    process.stdout.write(out.join(''))
  }
} catch (error) {
  if (error instanceof GlobError) fail(error.message)
  throw error
}
