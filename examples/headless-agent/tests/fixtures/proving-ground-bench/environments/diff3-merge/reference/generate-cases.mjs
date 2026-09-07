#!/usr/bin/env node
/**
 * Regenerate `cases.json` by running the reference on a fixed corpus: the
 * hand-written corners carry weight 3, the seeded edit triples weight 1. The
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

/** The three documents, framed the way the program reads them. */
const frame = (mine, base, theirs) => [mine, base, theirs].map(part => part.map(line => `${line}\n`).join('')).join('%%%\n')

const ABC = ['a', 'b', 'c', 'd', 'e']
const TRIPLES = [
  [ABC, ABC, ABC],
  [['a', 'X', 'c', 'd', 'e'], ABC, ABC],
  [ABC, ABC, ['a', 'b', 'c', 'd', 'Z']],
  [['X', 'b', 'c', 'd', 'e'], ABC, ['a', 'b', 'c', 'd', 'Z']],
  [['a', 'X', 'c', 'd', 'e'], ABC, ['a', 'Y', 'c', 'd', 'e']],
  [['a', 'X', 'c', 'd', 'e'], ABC, ['a', 'X', 'c', 'd', 'e']],
  [['a', 'X', 'c', 'd', 'e'], ABC, ['a', 'b', 'Y', 'd', 'e']],
  [['a', 'c', 'd', 'e'], ABC, ['a', 'b', 'c', 'd', 'e']],
  [['a', 'c', 'd', 'e'], ABC, ['a', 'c', 'd', 'e']],
  [['a', 'c', 'd', 'e'], ABC, ['a', 'b', 'c', 'e']],
  [['a', 'q', 'b', 'c', 'd', 'e'], ABC, ABC],
  [['a', 'q', 'b', 'c', 'd', 'e'], ABC, ['a', 'r', 'b', 'c', 'd', 'e']],
  [['a', 'q', 'b', 'c', 'd', 'e'], ABC, ['a', 'q', 'b', 'c', 'd', 'e']],
  [[], ABC, ABC],
  [ABC, ABC, []],
  [[], ABC, []],
  [[], [], []],
  [['x'], [], ['y']],
  [['x'], [], ['x']],
  [['x'], [], []],
  [ABC, [], ABC],
  [['a', 'b'], ['a', 'b'], ['a', 'b', 'c']],
  [['a', 'b', 'c'], ['a', 'b'], ['a', 'b', 'c']],
  [['a', 'b', 'c'], ['a', 'b'], ['a', 'b', 'd']],
  [['e', 'd', 'c', 'b', 'a'], ABC, ABC],
  [['a', 'a', 'a'], ['a'], ['a', 'a']],
  [['a'], ['a', 'a', 'a'], ['a', 'a']],
  [['', 'a'], ['a'], ['a', '']],
  [['  a'], ['a'], ['a  ']],
  [['%%'], ['%'], ['%%%%']],
  [['a', 'b', 'c'], ['a', 'B', 'c'], ['a', 'b', 'c']],
  [['x', 'a', 'b', 'c', 'd', 'e', 'y'], ABC, ['a', 'b', 'c', 'd', 'e', 'z']],
  [['a', 'a', 'b'], ['a', 'b'], ['a', 'b', 'b']],
  [['x', 'x', 'x'], ['x', 'x'], ['x']],
  [['a', 'b', 'a', 'b'], ['a', 'b'], ['b', 'a']],
  [['a', 'b', 'c', 'a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'b', 'c', 'a']],
  [['q', 'a', 'b'], ['a', 'b'], ['a', 'q', 'b']],
  [['a', 'b'], ['a', 'x', 'b'], ['a', 'b', 'x']],
  [['1', '2', '3', '2', '1'], ['1', '2', '1'], ['1', '2', '2', '1']],
  [['a'], ['a', 'a'], ['a', 'a', 'a']],
  [['b', 'a'], ['a', 'b'], ['a', 'b', 'a']],
  [ABC, ['a', 'b', 'c', 'd', 'e', 'a', 'b', 'c', 'd', 'e'], ABC],
  [['a', 'x', 'b', 'y', 'c'], ['a', 'b', 'c'], ['a', 'b', 'y', 'c']],
  [['a', 'b', 'c'], ['a', 'b', 'c'], ['c', 'b', 'a']],
]

const MODES = [['merge'], ['merge2'], ['regions']]
const MALFORMED = [
  [['merge'], ''],
  [['merge'], 'a\n%%%\nb\n'],
  [['merge'], 'a\n'],
  [['merge'], 'a\n%%%\nb\n%%%\nc\n%%%\nd\n'],
  [['regions'], '%%%\n%%%\n'],
  [['merge'], '\n%%%\n%%%\n'],
  [['diff'], 'a\n%%%\na\n%%%\na\n'],
  [[], 'a\n%%%\na\n%%%\na\n'],
  [['merge', 'extra'], 'a\n%%%\na\n%%%\na\n'],
]

const draw = rng(20260907)
const cases = []
const push = (weight, argv, stdin) => {
  cases.push({ id: `${weight === 3 ? 'corner' : 'seeded'}-${String(cases.length + 1).padStart(3, '0')}`, weight, argv, stdin })
}
for (const [mine, base, theirs] of TRIPLES) {
  for (const argv of MODES) push(3, argv, frame(mine, base, theirs))
}
for (const [argv, stdin] of MALFORMED) push(3, argv, stdin)

/** Apply a few random edits to a document, so both sides diverge from one base. */
function edit(base) {
  const lines = [...base]
  const count = 1 + draw(3)
  for (let step = 0; step < count; step += 1) {
    const where = draw(lines.length + 1)
    const action = draw(3)
    if (action === 0) lines.splice(where, 0, `n${draw(9)}`)
    else if (action === 1 && lines.length > 0) lines.splice(Math.min(where, lines.length - 1), 1)
    else if (lines.length > 0) lines[Math.min(where, lines.length - 1)] = `m${draw(9)}`
  }
  return lines
}

const seeded = new Set()
while (cases.length < 160) {
  const base = Array.from({ length: 3 + draw(6) }, (_, index) => `L${index}`)
  const stdin = frame(edit(base), base, edit(base))
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
