#!/usr/bin/env node
/** The command: `tokens` prints every token with its position, `stats` counts them by kind. */

import { readFileSync } from 'node:fs'
import { LexError, lex } from './lex.js'

/** Every kind the scanner can report, in the order `stats` lists them. */
const KINDS = ['ident', 'keyword', 'number', 'punct', 'rawstring', 'string']

/** Report one failure the way the specification words it, and stop. */
function fail(message) {
  process.stderr.write(`error: ${message}\n`)
  process.exit(2)
}

const argv = process.argv.slice(2)
if (argv.length !== 1 || (argv[0] !== 'tokens' && argv[0] !== 'stats')) fail('usage: cli.js tokens|stats')

let tokens
try {
  tokens = lex(readFileSync(0, 'utf8'))
} catch (error) {
  if (!(error instanceof LexError)) throw error
  fail(`${error.line}:${error.column}: ${error.message}`)
}

const out = argv[0] === 'tokens'
  ? tokens.map(token => {
    const body = token.kind === 'string' || token.kind === 'rawstring' ? JSON.stringify(token.text) : token.text
    return `${token.line}:${token.column} ${token.kind} ${body}`
  })
  : [...KINDS.map(kind => `${kind} ${tokens.filter(token => token.kind === kind).length}`), `total ${tokens.length}`]
process.stdout.write(out.map(line => `${line}\n`).join(''))
