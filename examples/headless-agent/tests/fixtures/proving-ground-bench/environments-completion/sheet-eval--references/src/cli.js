#!/usr/bin/env node
/** The command: `values` prints every declared cell's value, `deps` its direct references. */

import { readFileSync } from 'node:fs'
import { references, Sheet, show } from './evaluate.js'
import { address } from './parse.js'

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
if (argv.length !== 1 || (argv[0] !== 'values' && argv[0] !== 'deps')) fail('usage: cli.js values|deps')

const cells = new Map()
lines().forEach((raw, index) => {
  const line = raw.replace(/^[ \t]+/u, '')
  const at = index + 1
  if (line === '' || line.startsWith('#')) return
  const cut = /[ \t]+/u.exec(line)
  const cell = (cut === null ? line : line.slice(0, cut.index)).toUpperCase()
  const content = cut === null ? '' : line.slice(cut.index + cut[0].length)
  if (address(cell) === undefined) fail(`line ${at}: invalid cell address ${cell}`)
  if (cells.has(cell)) fail(`line ${at}: cell ${cell} is declared twice`)
  cells.set(cell, content)
})

const ordered = [...cells.keys()].sort((left, right) => {
  const a = address(left)
  const b = address(right)
  return a.column - b.column || a.row - b.row
})
const sheet = new Sheet(cells)
const out = argv[0] === 'values'
  ? ordered.map(cell => `${cell}=${show(sheet.value(cell))}`)
  : ordered.map(cell => `${cell}:${references(cells.get(cell)).map(one => ` ${one}`).join('')}`)
process.stdout.write(out.map(line => `${line}\n`).join(''))
