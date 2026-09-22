#!/usr/bin/env node
/**
 * Regenerate `cases.json` by running the reference on a fixed corpus: the
 * hand-written corners carry weight 3, the seeded logs weight 1. The corpus and
 * the generator are deterministic, so a rerun rewrites the same bytes.
 *
 * Every case runs from the task directory, because the corpus names the policy
 * files under `data/` and the runner starts a cased check there too.
 *
 *   node generate-cases.mjs
 */

import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('./src/cli.js', import.meta.url))
const cwd = fileURLToPath(new URL('../', import.meta.url))
const out = fileURLToPath(new URL('./cases.json', import.meta.url))

/** One 32-bit linear congruential stream, so a rerun draws the same corpus. */
function rng(seed) {
  let state = seed >>> 0
  return (limit) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state % limit
  }
}

const LOGS = [
  'job a 2 fail fail ok\nsubmit 0 a\n',
  'job a 1 fail\nsubmit 0 a\n',
  'job a 1 ok\njob b 1 fail ok\nsubmit 0 a\nsubmit 0 b\n',
  'job a 5 fail\njob b 1 fail\nsubmit 0 a\nsubmit 0 b\n',
  'job a 0 fail ok\nsubmit 0 a\n',
  'job a 0 fail\nsubmit 3 a\n',
  'job a 1 ok\njob b 1 ok\njob c 1 ok\nsubmit 0 a\nsubmit 0 b\nsubmit 0 c\n',
  'job a 1 ok\njob b 1 ok\njob c 1 ok\nsubmit 0 c\nsubmit 0 b\nsubmit 0 a\n',
  'job a 1 ok\njob b 1 ok\nsubmit 40 a\nsubmit 0 b\n',
  'job a 3 fail ok fail ok\nsubmit 0 a\n',
  'job a 1 fail ok\njob b 2 fail fail ok\nsubmit 0 a\nsubmit 1 b\n',
  'job a 1 ok\n',
  '',
  '# only a comment\n',
  'retry 2 4\njob a 1 fail\nsubmit 0 a\n',
  'retry 1 4\njob a 1 fail\nsubmit 0 a\n',
  'limit 1 5\nretry 3 1\njob a 1 fail fail ok\nsubmit 0 a\n',
  'limit 3 4\nretry 2 0\njob a 1 fail\njob b 1 fail\njob c 1 ok\nsubmit 0 a\nsubmit 0 b\nsubmit 0 c\n',
  'retry 5 1\njob a 1 fail fail fail fail ok\nsubmit 0 a\n',
  'retry 3 0\njob a 1 fail\njob b 1 ok\nsubmit 0 a\nsubmit 0 b\n',
  'retry 2 100\njob a 1 fail\njob b 1 ok\nsubmit 0 a\nsubmit 50 b\n',
  'retry 2 4\nretry 3 4\n',
  'limit 2 10\nlimit 2 10\n',
  'retry 0 4\n',
  'retry 2\n',
  'retry 2 x\n',
  'limit 2 0\n',
  'limit 2\n',
  'job a 1\n',
  'job a x ok\n',
  'job a 1 maybe\n',
  'job a! 1 ok\n',
  'job a 1 ok\njob a 2 ok\n',
  'job a 1 ok\nsubmit 0 a\nsubmit 1 a\n',
  'job a 1 ok\nsubmit x a\n',
  'job a 1 ok\nsubmit 0\n',
  'job a 1 ok\nsubmit 0 ghost\n',
  'cancel a\n',
  'job a 01 ok\nsubmit 00 a\n',
]

const POLICIES = [
  [],
  ['data/steady.policy'],
  ['data/retry-only.policy'],
  ['data/limit-only.policy'],
  ['data/empty.policy'],
  ['data/bad.policy'],
  ['data/twice.policy'],
  ['data/nope.policy'],
]

const MODES = ['trace', 'summary', 'dead']
const BAD_ARGV = [[], ['walk'], ['trace', 'data/steady.policy', 'x'], ['Trace']]

const cases = []
const push = (weight, argv, stdin) => {
  cases.push({ id: `${weight === 3 ? 'corner' : 'seeded'}-${String(cases.length + 1).padStart(3, '0')}`, weight, argv, stdin })
}

for (const log of LOGS) {
  for (const mode of MODES) push(3, [mode, 'data/steady.policy'], log)
}
for (const policy of POLICIES) {
  for (const mode of MODES) push(3, [mode, ...policy], LOGS[0])
}
for (const policy of POLICIES.slice(0, 5)) push(3, ['dead', ...policy], LOGS[3])
for (const argv of BAD_ARGV) push(3, argv, LOGS[0])

const draw = rng(20260919)
const IDS = ['a', 'b', 'c', 'd']
const seeded = new Set()
while (cases.length < 160) {
  const count = 1 + draw(4)
  const ids = IDS.slice(0, count)
  const body = []
  if (draw(3) === 0) body.push(`limit ${1 + draw(3)} ${1 + draw(9)}`)
  if (draw(2) === 0) body.push(`retry ${1 + draw(4)} ${draw(6)}`)
  for (const id of ids) {
    const outcomes = []
    const many = 1 + draw(3)
    for (let index = 0; index < many; index += 1) outcomes.push(draw(2) === 0 ? 'ok' : 'fail')
    body.push(`job ${id} ${draw(4)} ${outcomes.join(' ')}`)
  }
  for (const id of ids) {
    if (draw(5) !== 0) body.push(`submit ${draw(8)} ${id}`)
  }
  const stdin = `${body.join('\n')}\n`
  const policy = POLICIES[draw(5)]
  const argv = [MODES[draw(MODES.length)], ...policy]
  const key = `${argv.join(' ')} ${stdin}`
  if (seeded.has(key)) continue
  seeded.add(key)
  push(1, argv, stdin)
}

const bodies = cases.map((one) => {
  const run = spawnSync(process.execPath, [cli, ...one.argv], { cwd, encoding: 'utf8', input: one.stdin })
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
