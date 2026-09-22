#!/usr/bin/env node
/**
 * Regenerate `cases.json` by running the reference on a fixed corpus: the
 * hand-written corners carry weight 3, the seeded paragraphs weight 1. The
 * corpus and the generator are deterministic, so a rerun rewrites the same
 * bytes.
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

const SOFT = '\u00AD'
const FOX = 'the quick brown fox jumps over the lazy dog\n'
const HYPHENS = `aaa hy${SOFT}phen${SOFT}ation bbb ex${SOFT}tra${SOFT}or${SOFT}di${SOFT}nary\n`
const MIXED = `a\u0301bc \u6F22\u5B57\u6F22\u5B57 xy zz\u0300\u0301 \uFF21\uFF22 tail\n`

const CORNERS = [
  [['wrap', '12'], FOX], [['justify', '12'], FOX], [['wrap', '1'], FOX], [['justify', '1'], FOX],
  [['wrap', '43'], FOX], [['justify', '43'], FOX], [['wrap', '44'], FOX], [['wrap', '7'], FOX], [['justify', '7'], FOX],
  [['wrap', '8'], HYPHENS], [['justify', '8'], HYPHENS], [['wrap', '5'], HYPHENS], [['wrap', '40'], HYPHENS],
  [['wrap', '6'], MIXED], [['justify', '6'], MIXED], [['wrap', '3'], MIXED], [['wrap', '30'], MIXED],
  [['wrap', '10'], ''], [['justify', '10'], ''],
  [['wrap', '10'], '\n\n\n'], [['wrap', '10'], '   \n\t\n'],
  [['wrap', '10'], 'one two\n\n\nthree four\n'], [['justify', '10'], 'one two\n\n\nthree four\n'],
  [['wrap', '10'], '\n\nonly\n\n'],
  [['wrap', '11'], 'alpha\nbeta gamma\ndelta\n'],
  [['wrap', '5'], 'supercalifragilistic x\n'], [['justify', '5'], 'supercalifragilistic x\n'],
  [['wrap', '4'], `su${SOFT}per x\n`], [['wrap', '3'], `su${SOFT}per x\n`], [['wrap', '2'], `su${SOFT}per x\n`],
  [['wrap', '9'], `${SOFT}abc def\n`], [['wrap', '9'], `abc${SOFT} def\n`],
  [['justify', '20'], 'a bb ccc dddd e f g\n'], [['justify', '19'], 'a bb ccc dddd e f g\n'],
  [['justify', '18'], 'a bb ccc dddd e f g\n'], [['justify', '13'], 'a bb ccc dddd e f g\n'],
  [['wrap', '10'], 'a   b\t\tc\n'],
  [['wrap', '10'], 'trailing   \n'],
  [['justify', '12'], 'one two\nthree four five six\n'],
  [['wrap', '2'], '\u6F22 a\n'], [['justify', '2'], '\u6F22 a\n'],
  [['wrap', '0'], FOX], [['wrap', '-3'], FOX], [['wrap', '03'], FOX], [['wrap', 'ten'], FOX],
  [['fill', '10'], FOX], [['wrap'], FOX], [['wrap', '10', '20'], FOX], [[], FOX],
  [['wrap', '10'], `a b${SOFT}c${SOFT}d${SOFT}e${SOFT}f${SOFT}g${SOFT}h\n`],
  [['wrap', '4'], `b${SOFT}c${SOFT}d${SOFT}e${SOFT}f\n`],
  [['justify', '10'], `a b${SOFT}cdefghij k\n`],
  [['wrap', '5'], 'abcde f\n'], [['wrap', '5'], 'abcdef g\n'],
  [['justify', '5'], 'ab cd\n'], [['justify', '6'], 'ab cd\n'], [['justify', '4'], 'ab cd\n'],
  [['justify', '100'], 'a b c\nd e\n\nf g h i\n'],
  [['justify', '11'], 'aa bb cc dd ee ff\n'],
  [['justify', '12'], 'aa bb cc dd ee ff\n'],
  [['wrap', '5'], `\u6F22${SOFT}\u5B57 a\n`],
  [['wrap', '3'], 'a\u0300\u0301\u0302b c\n'],
  [['justify', '7'], 'a\u0300 b\u0301 c\u0302 dd\n'],
  [['wrap', '2'], '\uFF21 \uFF22\n'],
  [['justify', '9'], 'one two three four\n'],
  [['justify', '8'], 'one two three four\n'],
  [['wrap', '1'], `a${SOFT}b\n`],
  [['wrap', '2'], `a${SOFT}b\n`],
  [['wrap', '3'], `a${SOFT}b\n`],
  [['justify', '15'], 'x y\nz\n\n\nq r s t u v w\n'],
]

const WORDS = [
  'alpha', 'be', 'c', 'delta', 'ee', 'fig', 'grape', 'hi', 'ionosphere', 'jam',
  `mul${SOFT}ti`, `over${SOFT}flow${SOFT}ing`, '\u6F22\u5B57', 'a\u0301e\u0301', '\uFF21\uFF22\uFF23', 'zzzzzzzzzzzz',
]
const WIDTHS = ['3', '5', '8', '12', '20', '31']

const draw = rng(20260907)
const cases = []
const push = (weight, argv, stdin) => {
  cases.push({ id: `${weight === 3 ? 'corner' : 'seeded'}-${String(cases.length + 1).padStart(3, '0')}`, weight, argv, stdin })
}
for (const [argv, stdin] of CORNERS) push(3, argv, stdin)

const seeded = new Set()
while (cases.length < 160) {
  const blocks = 1 + draw(2)
  const body = []
  for (let block = 0; block < blocks; block += 1) {
    if (block > 0) body.push('')
    const count = 2 + draw(9)
    body.push(Array.from({ length: count }, () => WORDS[draw(WORDS.length)]).join(' '))
  }
  const stdin = `${body.join('\n')}\n`
  const argv = [draw(2) === 0 ? 'wrap' : 'justify', WIDTHS[draw(WIDTHS.length)]]
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
