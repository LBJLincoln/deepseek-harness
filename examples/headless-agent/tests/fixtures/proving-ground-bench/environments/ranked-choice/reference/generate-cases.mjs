#!/usr/bin/env node
/**
 * Regenerate `cases.json` by running the reference on a fixed corpus: the
 * hand-written corners carry weight 3, the seeded elections weight 1. The
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

const CORNERS = [
  'candidates a b\nballot 3 a\nballot 1 b\n',
  'candidates alice bob carol\nballot 4 alice bob\nballot 3 bob carol\nballot 2 carol bob\nballot 1 carol\n',
  'candidates a b c\nballot 3 a\nballot 2 b\nballot 1 c\n',
  'candidates a b c\nballot 2 a\nballot 2 b\nballot 2 c\n',
  'candidates a b c\nballot 2 a b\nballot 2 b a\nballot 2 c\n',
  'candidates a b c d\nballot 1 a\nballot 1 b\nballot 1 c\nballot 1 d\n',
  'candidates a b c d\nballot 5 a\nballot 1 b c\nballot 1 c b\nballot 1 d\n',
  'candidates a b\n',
  'candidates a b c\nballot 1 a\n',
  'candidates zeta alpha\nballot 1 zeta\nballot 1 alpha\n',
  'candidates a b c\nballot 1 c\nballot 1 b\nballot 1 a\n',
  'candidates aa ab ac\nballot 2 aa\nballot 2 ab\nballot 2 ac\n',
  'candidates a b c\nballot 4 a b c\nballot 4 b a c\nballot 3 c\n',
  'candidates a b c d e\nballot 6 a\nballot 5 b\nballot 4 c\nballot 4 d\nballot 1 e d\n',
  'candidates a b c\nballot 1 a b c\nballot 1 b c a\nballot 1 c a b\n',
  'candidates a b c\nballot 10 a b\nballot 10 b a\nballot 1 c\n',
  '# leading comment\n\ncandidates a\nballot 1 a\n',
  '   candidates a b   \n  ballot 2 a  \n',
  'candidates a b c\nballot 1 a\nballot 1 a\nballot 1 b\nballot 1 c\n',
  'candidates a b c d\nballot 3 d c b a\nballot 3 c d b a\nballot 2 b\nballot 2 a\n',
  'candidates a b c d\nballot 4 a\nballot 2 b c\nballot 2 c b\nballot 2 d b\n',
  'candidates a b c\nballot 2 a\nballot 2 b\n',
  'candidates a b c d\nballot 5 a\nballot 3 b\nballot 1 c d\nballot 1 d c\n',
  'candidates a b c d e\nballot 1 a\nballot 1 b\nballot 1 c\nballot 1 d\nballot 1 e\n',
  'candidates p q r s\nballot 6 p\nballot 3 q r\nballot 3 r q\nballot 2 s q\n',
  'candidates a b c d\nballot 2 a b\nballot 2 b a\nballot 1 c d\nballot 1 d c\n',
  'candidates a b c d e\nballot 4 a\nballot 3 b\nballot 3 c\nballot 1 d e\nballot 1 e d\n',
  'candidates ab aa ac\nballot 2 ab\nballot 2 aa\nballot 2 ac\n',
  'candidates a b c\nballot 3 a b\nballot 3 b a\n',
  'candidates a b c\nballot 1 a b c\nballot 1 a c b\nballot 2 b\n',
  'candidates a b c d\nballot 3 a\nballot 3 b\nballot 3 c\nballot 3 d\n',
  'candidates a b c d\nballot 1 d\nballot 2 c\nballot 2 b\nballot 1 a\n',
  'ballot 1 a\ncandidates a\n',
  'candidates a\ncandidates b\n',
  'candidates a\nballot 1 z\n',
  'candidates a b\nballot 1 a b a\n',
  'candidates a\nballot 0 a\n',
  'candidates a\nballot 01 a\n',
  'candidates a\nballot -1 a\n',
  'candidates a\nballot 1\n',
  'candidates a\nballot\n',
  'candidates\n',
  'candidates a a\n',
  'candidates a!\n',
  '# nothing\n',
  '',
  'candidates a\nvote 1 a\n',
]

const MODES = [['rounds'], ['tally']]
const BAD_MODES = [['count'], [], ['rounds', 'tally'], ['Rounds']]

const draw = rng(20260907)
const cases = []
const push = (weight, argv, stdin) => {
  cases.push({ id: `${weight === 3 ? 'corner' : 'seeded'}-${String(cases.length + 1).padStart(3, '0')}`, weight, argv, stdin })
}
for (const stdin of CORNERS) {
  for (const argv of MODES) push(3, argv, stdin)
}
for (const argv of BAD_MODES) push(3, argv, CORNERS[1])

const POOL = ['ann', 'bo', 'cy', 'dee', 'eli', 'fay']
const seeded = new Set()
while (cases.length < 170) {
  const size = 2 + draw(5)
  const names = POOL.slice(0, size)
  const body = [`candidates ${names.join(' ')}`]
  const ballots = 2 + draw(6)
  for (let index = 0; index < ballots; index += 1) {
    const ranking = []
    const left = [...names]
    const depth = 1 + draw(size)
    for (let step = 0; step < depth; step += 1) ranking.push(...left.splice(draw(left.length), 1))
    body.push(`ballot ${1 + draw(6)} ${ranking.join(' ')}`)
  }
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
