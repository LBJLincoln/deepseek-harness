#!/usr/bin/env node
/**
 * Regenerate `cases.json` by running the reference on a fixed corpus: the
 * hand-written corners carry weight 3, the seeded graphs weight 1. The corpus
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

const DIAMOND = 'task a 3\ntask b 2\ntask c 4\ntask d 1\ndep b a\ndep c a\ndep d b c\n'
const CHAIN = 'task x 1\ntask y 2\ntask z 3\ndep y x\ndep z y\n'
const WIDE = 'task r 1\ntask a 5\ntask b 5\ntask c 5\ntask d 5\ndep a r\ndep b r\ndep c r\ndep d r\n'
const ZERO = 'task a 0\ntask b 1\ntask c 0\ndep b a\ndep c b\n'
const TIES = 'task aa 2\ntask ab 2\ntask ac 2\ntask ad 2\n'

const CORNERS = [
  [['waves'], DIAMOND], [['explain'], DIAMOND], [['pack', '1'], DIAMOND], [['pack', '2'], DIAMOND], [['pack', '3'], DIAMOND],
  [['waves'], CHAIN], [['explain'], CHAIN], [['pack', '2'], CHAIN],
  [['waves'], WIDE], [['pack', '2'], WIDE], [['pack', '3'], WIDE], [['pack', '4'], WIDE], [['pack', '9'], WIDE],
  [['waves'], ZERO], [['explain'], ZERO], [['pack', '1'], ZERO], [['pack', '2'], ZERO],
  [['waves'], TIES], [['pack', '3'], TIES],
  [['waves'], ''], [['explain'], ''], [['pack', '2'], ''],
  [['waves'], 'task solo 7\n'], [['pack', '1'], 'task solo 7\n'],
  [['waves'], 'task a 0\n'],
  [['waves'], '# only a comment\n\n   \n'],
  [['waves'], 'task a 1\ntask b 1\ndep b a\ndep b a\n'],
  [['waves'], 'task a 1\ntask b 1\ntask c 1\ndep c a b\n'],
  [['waves'], 'dep b a\ntask a 1\ntask b 1\n'],
  [['waves'], 'task a 1\ndep a a\n'],
  [['waves'], 'task a 1\ntask b 1\ndep a b\ndep b a\n'],
  [['waves'], 'task c 1\ntask b 1\ntask a 1\ndep a b\ndep b c\ndep c a\n'],
  [['waves'], 'task a 1\ntask b 1\ntask c 1\ntask d 1\ndep b a\ndep c b\ndep b c\n'],
  [['explain'], 'task a 1\ntask b 1\ndep a b\ndep b a\n'],
  [['waves'], 'task a 1\ntask a 2\n'],
  [['waves'], 'task a -1\n'],
  [['waves'], 'task a 1.5\n'],
  [['waves'], 'task a 01\n'],
  [['waves'], 'task a\n'],
  [['waves'], 'task a 1 2\n'],
  [['waves'], 'dep a\n'],
  [['waves'], 'task a 1\ndep a ghost\n'],
  [['waves'], 'task a 1\ndep ghost a\n'],
  [['waves'], 'build a 1\n'],
  [['waves'], 'task a! 1\n'],
  [['pack', '0'], DIAMOND],
  [['pack'], DIAMOND],
  [['pack', '2', '3'], DIAMOND],
  [['sprint'], DIAMOND],
  [['waves', 'extra'], DIAMOND],
  [['pack', '2'], 'task a 0\ntask b 0\ntask c 0\ntask d 4\ndep b a\ndep c b\ndep d c\n'],
  [['pack', '1'], 'task a 0\ntask b 0\ntask c 0\ntask d 4\ndep b a\ndep c b\ndep d c\n'],
  [['pack', '2'], 'task long 9\ntask s1 1\ntask s2 1\ntask s3 1\n'],
  [['pack', '2'], 'task s1 1\ntask s2 1\ntask s3 1\ntask long 9\n'],
  [['pack', '2'], 'task a 1\ntask b 1\ntask c 1\ntask d 1\ndep c a\ndep d b\n'],
  [['pack', '3'], 'task r 1\ntask a 3\ntask b 3\ntask c 1\ntask tail 1\ndep a r\ndep b r\ndep c r\ndep tail c\n'],
  [['pack', '2'], 'task a 2\ntask b 2\ntask c 2\ntask d 2\ntask e 2\n'],
  [['pack', '2'], 'task z 5\ntask y 5\ntask x 1\ndep x z\ndep x y\n'],
  [['pack', '2'], 'task a 3\ntask b 1\ntask c 1\ntask d 1\ndep b a\n'],
  [['explain'], 'task a 0\ntask b 0\ntask c 0\ndep b a\ndep c b\n'],
  [['waves'], 'task a 0\ntask b 0\ntask c 0\ndep b a\ndep c b\n'],
  [['pack', '4'], 'task solo 0\n'],
  [['pack', '1'], 'task a 0\ntask b 0\n'],
  [['waves'], 'task a 1\ntask b 1\ntask c 1\ndep c a\ndep c b\ndep b a\n'],
  [['explain'], 'task a 1\ntask b 1\ntask c 1\ndep c a\ndep c b\ndep b a\n'],
  [['waves'], 'task B 1\ntask a 1\ntask A 1\ntask b 1\n'],
  [['pack', '2'], 'task B 1\ntask a 1\ntask A 1\ntask b 1\n'],
]

const draw = rng(20260907)
const cases = []
const push = (weight, argv, stdin) => {
  cases.push({ id: `${weight === 3 ? 'corner' : 'seeded'}-${String(cases.length + 1).padStart(3, '0')}`, weight, argv, stdin })
}
for (const [argv, stdin] of CORNERS) push(3, argv, stdin)

const MODES = [['waves'], ['explain'], ['pack', '1'], ['pack', '2'], ['pack', '3'], ['pack', '5']]
const seeded = new Set()
while (cases.length < 140) {
  const size = 3 + draw(7)
  const names = Array.from({ length: size }, (_, index) => `n${String(index).padStart(2, '0')}`)
  const body = names.map(name => `task ${name} ${draw(5)}`)
  for (let index = 1; index < size; index += 1) {
    const links = draw(3)
    for (let edge = 0; edge <= links; edge += 1) {
      const from = draw(index)
      body.push(`dep ${names[index]} ${names[from]}`)
    }
  }
  // A tenth of the graphs get a back edge, so the cycle report is measured too.
  if (draw(10) === 0 && size > 2) body.push(`dep ${names[draw(size - 1)]} ${names[size - 1]}`)
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
