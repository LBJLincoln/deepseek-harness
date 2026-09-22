#!/usr/bin/env node
/**
 * Regenerate `cases.json` by running the reference on a fixed corpus: the
 * hand-written corners carry weight 3, the seeded logs weight 1. The corpus and
 * the generator are deterministic, so a rerun rewrites the same bytes.
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

const FILES = [
  'bucket b 2 1 3\nroute k b\nevent 0 k1\nevent 0 k1\nevent 0 k1\nevent 3 k1\nevent 6 k1\n',
  'bucket b 1 1 2\nroute k b\nevent 0 k1\nevent 1 k1\nevent 2 k1\nevent 3 k1\nevent 4 k1\n',
  'bucket b 3 2 5\nroute k b\nevent 0 k1\nevent 0 k1\nevent 0 k1\nevent 0 k1\nevent 2 k1\nevent 5 k1\nevent 5 k1\nevent 20 k1\nevent 20 k1\nevent 20 k1\nevent 20 k1\n',
  'bucket b 2 0 1\nroute k b\nevent 0 k1\nevent 100 k1\nevent 200 k1\n',
  'window w 2 4\nroute k w\nevent 0 k1\nevent 1 k1\nevent 2 k1\nevent 3 k1\nevent 4 k1\nevent 5 k1\n',
  'window w 0 3\nroute k w\nevent 0 k1\nevent 5 k1\n',
  'window w 3 1\nroute k w\nevent 0 k1\nevent 0 k1\nevent 0 k1\nevent 0 k1\nevent 1 k1\n',
  'bucket small 2 1 3\nwindow burst 3 5\nroute api/ small\nroute api/hot small burst\nevent 0 api/a\nevent 0 api/a\nevent 0 api/a\nevent 0 other\nevent 3 api/a\nevent 4 api/hot/x\nevent 4 api/hot/x\nevent 4 api/hot/x\nevent 9 api/hot/x\n',
  'bucket wide 5 0 1\nbucket tight 1 0 1\nroute a wide\nroute ab tight\nevent 0 abc\nevent 0 abc\nevent 0 ax\nevent 0 ax\n',
  'bucket b 5 0 1\nwindow w 1 9\nroute k b w\nevent 0 k1\nevent 0 k1\nevent 0 k1\n',
  'window w 1 9\nbucket b 5 0 1\nroute k w b\nevent 0 k1\nevent 0 k1\n',
  'bucket b 1 1 5\nroute k b\nevent 0 k1\nevent 0 k2\nevent 0 k3\nevent 5 k1\nevent 5 k2\n',
  'bucket b 1 0 1\nroute k b\nevent 0 other\nevent 0 other\n',
  'bucket b 1 3 1\nroute k b\nevent 0 k1\nevent 1 k1\nevent 1 k1\n',
  'bucket b 10 1 1\nroute k b\nevent 0 k1\nevent 0 k1\nevent 0 k1\nevent 0 k1\nevent 0 k1\nevent 0 k1\nevent 0 k1\nevent 0 k1\nevent 0 k1\nevent 0 k1\nevent 0 k1\nevent 1 k1\n',
  '# comment\n\nbucket b 1 0 1\nroute k b\nevent 0 k1\n',
  'bucket b 1 0 1\nroute k b\n',
  '',
  'bucket b 1 0 1\nroute k b\nevent 3 k1\nevent 1 k1\n',
  'route k ghost\n',
  'bucket b 1 0 1\nroute k b\nevent 0 k1\nwindow w 1 1\n',
  'bucket b 1 0 1\nwindow b 1 1\n',
  'bucket b 1 0 1\nroute k b\nroute k b\n',
  'limit b 1\n',
  'bucket b 0 1 1\n',
  'bucket b 1 -1 1\n',
  'bucket b 1 1 0\n',
  'window w 1 0\n',
  'bucket b 1 1\n',
  'window w 1 1 1\n',
  'route k\n',
  'event 0 k1\n',
  'event -1 k1\n',
  'bucket b 01 1 1\n',
  'bucket b! 1 1 1\n',
  'bucket b 1 1 7\nroute k b\nevent 0 k1\nevent 1 k1\nevent 2 k1\nevent 3 k1\nevent 4 k1\nevent 5 k1\nevent 6 k1\nevent 7 k1\nevent 8 k1\nevent 13 k1\nevent 14 k1\n',
  'bucket b 2 3 4\nroute k b\nevent 0 k1\nevent 0 k1\nevent 1 k1\nevent 2 k1\nevent 3 k1\nevent 4 k1\nevent 5 k1\n',
  'bucket b 1 5 3\nroute k b\nevent 0 k1\nevent 1 k1\nevent 2 k1\nevent 3 k1\n',
  'window w 2 1\nroute k w\nevent 0 k1\nevent 0 k1\nevent 0 k1\nevent 1 k1\nevent 1 k1\nevent 1 k1\n',
  'bucket b 1 1 4\nwindow w 5 2\nroute k b w\nevent 0 k1\nevent 1 k1\nevent 4 k1\nevent 5 k1\nevent 8 k1\n',
  'window w 1 4\nbucket b 3 1 1\nroute k w b\nevent 0 k1\nevent 1 k1\nevent 2 k1\nevent 4 k1\nevent 5 k1\n',
  'bucket b 2 1 2\nroute a b\nroute ab b\nroute abc b\nevent 0 abcd\nevent 0 abcd\nevent 0 abd\nevent 0 ad\n',
  'bucket b 1 0 1\nroute k b\nroute kk b\nevent 0 kkx\nevent 0 kx\nevent 0 kkx\n',
  'bucket b 3 1 1\nroute k b\nevent 0 k1\nevent 0 k1\nevent 0 k1\nevent 0 k1\nevent 0 k1\nevent 1 k1\nevent 1 k1\n',
  'window w 2 3\nroute k b\n',
  'bucket b 1 1 1000\nroute k b\nevent 0 k1\nevent 999 k1\nevent 1000 k1\nevent 1999 k1\nevent 2000 k1\n',
]

const MODES = [['replay'], ['summary']]
const BAD = [[['simulate'], ''], [[], ''], [['replay', 'summary'], '']]

const draw = rng(20260907)
const cases = []
const push = (weight, argv, stdin) => {
  cases.push({ id: `${weight === 3 ? 'corner' : 'seeded'}-${String(cases.length + 1).padStart(3, '0')}`, weight, argv, stdin })
}
for (const stdin of FILES) {
  for (const argv of MODES) push(3, argv, stdin)
}
for (const [argv, stdin] of BAD) push(3, argv, stdin)

const KEYS = ['a/1', 'a/2', 'a/b/1', 'b/1', 'zzz']
const seeded = new Set()
while (cases.length < 150) {
  const body = [
    `bucket bk ${1 + draw(3)} ${draw(3)} ${1 + draw(4)}`,
    `window wn ${draw(4)} ${1 + draw(6)}`,
  ]
  body.push(draw(2) === 0 ? 'route a/ bk' : 'route a/ bk wn')
  if (draw(2) === 0) body.push('route a/b wn')
  let tick = 0
  const count = 4 + draw(9)
  for (let index = 0; index < count; index += 1) {
    tick += draw(3)
    body.push(`event ${tick} ${KEYS[draw(KEYS.length)]}`)
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
