#!/usr/bin/env node
/** The command: one mode word, one record per stdin line, one result per line. */

import { readFileSync } from 'node:fs'
import { normalize, resolve, UriError } from './uri.js'

/** Report one failure the way the specification words it, and stop. */
function fail(message) {
  process.stderr.write(`error: ${message}\n`)
  process.exit(2)
}

/** Every input line, with the trailing newline's empty tail dropped. */
function lines() {
  const text = readFileSync(0, 'utf8')
  const split = text.split('\n')
  if (split.length > 0 && split[split.length - 1] === '') split.pop()
  return split
}

const mode = process.argv.slice(2)
if (mode.length !== 1 || (mode[0] !== 'normalize' && mode[0] !== 'resolve')) fail('usage: cli.js normalize|resolve')

const out = []
const input = lines()
for (let index = 0; index < input.length; index += 1) {
  const line = input[index]
  const at = `line ${index + 1}`
  try {
    if (mode[0] === 'normalize') {
      out.push(normalize(line))
      continue
    }
    const space = line.indexOf(' ')
    if (space === -1) fail(`${at}: expected a base and a reference`)
    out.push(resolve(line.slice(0, space), line.slice(space + 1)))
  } catch (error) {
    if (error instanceof UriError) fail(`${at}: ${error.message}`)
    throw error
  }
}
process.stdout.write(out.map(line => `${line}\n`).join(''))
