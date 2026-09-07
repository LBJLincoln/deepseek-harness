#!/usr/bin/env node
/**
 * Regenerate `cases.json` by running the reference on a fixed corpus: the
 * hand-written corners carry weight 3, the seeded sheets weight 1. The corpus
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

const SHEETS = [
  'A1 3\nA2 4\nA3 =SUM(A1:A2)\nB1 =A3*2\n',
  'A1 =1/0\nA2 =A1+1\nA3 =IF(1, 5, A1)\nA4 =IF(0, 5, A1)\n',
  'A1 hello\nA2 =A1+1\nA3 =A1&1\nA4 =A1>2\nA5 =A1="hello"\n',
  'A1 =D1\nB1 =A1\nC1 =B1\nD1 =C1\n',
  'A1 =-2^2\nA2 =2^-2\nA3 =2^3^2\nA4 =-(2)^2\nA5 =+3\n',
  'A1 =1/3\nA2 =2/3\nA3 =0.1+0.2\nA4 =1e3\nA5 =10/4\n',
  'A1 1\nA2 x\nA3 \nB1 =COUNT(A1:A3)\nB2 =AVG(A1:A3)\nB3 =MIN(A1:A3)\n',
  'A1 1\nA2 2\nA3 3\nB1 =SUM(A1:A3)\nB2 =SUM(A3:A1)\nB3 =MAX(A1:A3, 10)\n',
  'A1 =SUM()\nA2 =ABS(1,2)\nA3 =IF(1,2)\nA4 =ABS(-3)\n',
  'A1 =NOPE(1)\nA2 =sum(1,2)\nA3 =Sum(1,2)\n',
  'A1 =A1\nA2 =A2+1\n',
  'A1 =ZZ999\nA2 =AAA1\nA3 =A1000\nA4 =A0\n',
  'A1 =TRUE\nA2 =FALSE\nA3 =TRUE=1\nA4 =IF(TRUE, 1, 2)\nA5 =TRUE>1\n',
  'A1 3\nA2 =A1:A2\nA3 =SUM(A1:A2)+1\n',
  'A1 #DIV/0!\nA2 =A1+1\nA3 #REF!\n',
  'a1 3\nb2 =a1+1\nc3 =SUM(a1:b2)\n',
  '   A1    7   \nB1 =A1\n',
  '# a comment\n\nA1 1\n\n',
  'A1 -3\nA2 =-A1\nA3 =ABS(A1)\nA4 -0\n',
  'A1 1.5\nA2 =A1*2\nA3 1.50\n',
  'A1 =1<2\nA2 =2<=2\nA3 =2<>2\nA4 =1>=2\nA5 =1=1\n',
  'A1 =(\nA2 =1+\nA3 =\nA4 =)\nA5 =1 2\n',
  'A1 5\nA2 =IF(A1>3, IF(A1>4, 1, 2), 3)\n',
  'A1 2\nB1 3\nC1 =A1*B1+A1/B1\n',
  'A1 =SUM(B1:B3)\nB1 1\nB2 =A1\nB3 3\n',
  'AAA1 3\n',
  'A1 1\nA1 2\n',
  '',
  'A1\n',
  'A1 =MAX(1,2,3)-MIN(1,2,3)\n',
]

const MODES = [['values'], ['deps']]
const BAD = [[['calc'], 'A1 1\n'], [[], 'A1 1\n'], [['values', 'deps'], 'A1 1\n']]

const draw = rng(20260907)
const cases = []
const push = (weight, argv, stdin) => {
  cases.push({ id: `${weight === 3 ? 'corner' : 'seeded'}-${String(cases.length + 1).padStart(3, '0')}`, weight, argv, stdin })
}
for (const stdin of SHEETS) {
  for (const argv of MODES) push(3, argv, stdin)
}
for (const [argv, stdin] of BAD) push(3, argv, stdin)

const CELLS = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2']
const ATOMS = ['A1', 'A2', 'B1', 'B2', 'C1', '2', '0', '3.5', 'SUM(A1:B2)', 'COUNT(A1:A3)', 'ABS(B1)', 'MIN(A1:B1)']
const OPERATORS = ['+', '-', '*', '/', '^', '>', '<', '=']
const LITERALS = ['1', '2', '-4', '0', 'text', '2.5', '']

const seeded = new Set()
while (cases.length < 150) {
  const body = []
  for (const cell of CELLS) {
    if (draw(4) === 0) continue
    if (draw(2) === 0) {
      body.push(`${cell} ${LITERALS[draw(LITERALS.length)]}`)
      continue
    }
    const left = ATOMS[draw(ATOMS.length)]
    const right = ATOMS[draw(ATOMS.length)]
    const formula = draw(6) === 0
      ? `IF(${left}>${right}, ${ATOMS[draw(ATOMS.length)]}, ${ATOMS[draw(ATOMS.length)]})`
      : `${left}${OPERATORS[draw(OPERATORS.length)]}${right}`
    body.push(`${cell} =${formula}`)
  }
  if (body.length === 0) continue
  const stdin = `${body.join('\n')}\n`
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
