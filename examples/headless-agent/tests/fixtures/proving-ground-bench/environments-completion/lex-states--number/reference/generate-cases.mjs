#!/usr/bin/env node
/**
 * Regenerate `cases.json` by running the reference on a fixed corpus: the
 * hand-written corners carry weight 3, the seeded sources weight 1. The corpus
 * and the generator are deterministic, so a rerun rewrites the same bytes.
 *
 *   node generate-cases.mjs
 */

import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('./src/cli.js', import.meta.url))
const out = fileURLToPath(new URL('./cases.json', import.meta.url))

/** One 32-bit linear congruential stream, so a rerun draws the same corpus. */
function rng(seed) {
  let state = seed >>> 0
  return limit => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state % limit
  }
}

const SOURCES = [
  'let x = 0x1F_2A;\n\tif (x >= 10) { return "a\\tb\\u{1F600}"; }\n',
  '/* outer /* inner */ still */ y => r"raw\nline";\n',
  '1.5e-3 1. .5 0b1010 0o17 09 0 00\n',
  '1e 1e+ 1e+2 1E-3 1_000 1_ _1 1__0\n',
  '0x 0b 0o 0xFF 0xff 0b12 0o18 0xG\n',
  '"\\n\\t\\r\\\\\\"\\0" "\\x41\\x7A" "\\u{41}\\u{10FFFF}"\n',
  '"\\q" "\\x4" "\\u{}" "\\u{110000}" "\\u41"\n',
  '"unterminated\n',
  'r"unterminated\n',
  '"has\nnewline"\n',
  'a\t\tb\n\t a\n',
  '\ta\n  \tb\n',
  '== != <= >= && || -> => + - * / % = < > ! ( ) { } [ ] , ; .\n',
  '=== <== ->> =>=\n',
  'let letx xlet if iff true false null nullish\n',
  '// only a comment\n',
  '// comment with no newline',
  '/* unterminated\n',
  '/* a */ /* b */\n',
  '/*/ still open */\n',
  '/**/x\n',
  '/* /* */ */x\n',
  '/* /* */ x\n',
  'a $ b\n',
  'a @ b\n',
  '#\n',
  '',
  '\n\n\n',
  '   \n\t\n',
  'r"a" r "a" rr"a"\n',
  '"" r""\n',
  'x."y"\n',
  '1.5.2\n',
  'abc123 _x9 __ x_\n',
  '"tab\there" "cr\\r"\n',
]

const MODES = [['tokens'], ['stats']]
const BAD = [[['scan'], 'a\n'], [[], 'a\n'], [['tokens', 'stats'], 'a\n']]

const PIECES = [
  'let ', 'x', ' = ', '1', '0x1f', '"s"', 'r"s"', '// c\n', '/* c */', '\t', '\n', ' ',
  '>=', '=>', '.', ';', '(', ')', '1.5', '_id', 'true', '1e3', '"\\t"', '/* /* */ */',
]

const draw = rng(20260907)
const cases = []
const push = (weight, argv, stdin) => {
  cases.push({ id: `${weight === 3 ? 'corner' : 'seeded'}-${String(cases.length + 1).padStart(3, '0')}`, weight, argv, stdin })
}
for (const stdin of SOURCES) {
  for (const argv of MODES) push(3, argv, stdin)
}
for (const [argv, stdin] of BAD) push(3, argv, stdin)

const seeded = new Set()
while (cases.length < 160) {
  const size = 3 + draw(10)
  // Two word-like pieces are separated, so most seeded sources reach the token
  // stream instead of stopping at the first number that ran into a name.
  let stdin = ''
  for (let step = 0; step < size; step += 1) {
    const piece = PIECES[draw(PIECES.length)]
    if (/[A-Za-z0-9_]$/u.test(stdin) && /^[A-Za-z0-9_]/u.test(piece)) stdin += ' '
    stdin += piece
  }
  const argv = MODES[draw(MODES.length)]
  const key = `${argv.join(' ')} ${stdin}`
  if (seeded.has(key)) continue
  seeded.add(key)
  push(1, argv, stdin)
}

const bodies = cases.map(one => {
  const run = spawnSync(process.execPath, [cli, ...one.argv], { encoding: 'utf8', input: one.stdin })
  if (run.error !== undefined) throw run.error
  return {
    id: one.id,
    weight: one.weight,
    argv: one.argv,
    stdin: one.stdin,
    exitCode: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    channels: ['exit', 'stdout', 'stderr'],
  }
})
writeFileSync(out, `${JSON.stringify(bodies, undefined, 1)}\n`)
process.stdout.write(`wrote ${bodies.length} cases\n`)
