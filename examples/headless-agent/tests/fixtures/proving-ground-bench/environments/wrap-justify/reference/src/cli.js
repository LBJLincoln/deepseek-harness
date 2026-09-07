#!/usr/bin/env node
/** The command: `wrap <width>` fills lines, `justify <width>` also pads them. */

import { readFileSync } from 'node:fs'
import { breakLines, justifyLine, paragraphs } from './layout.js'

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
if (argv.length !== 2 || (argv[0] !== 'wrap' && argv[0] !== 'justify')) fail('usage: cli.js wrap|justify <width>')
if (!/^[1-9]\d*$/u.test(argv[1])) fail('width must be a positive integer')

const limit = Number(argv[1])
const out = []
for (const words of paragraphs(lines())) {
  if (out.length > 0) out.push('')
  const broken = breakLines(words, limit)
  broken.forEach((line, index) => {
    const last = index === broken.length - 1
    out.push(argv[0] === 'wrap' || last ? line.join(' ') : justifyLine(line, limit))
  })
}
process.stdout.write(out.map(line => `${line}\n`).join(''))
