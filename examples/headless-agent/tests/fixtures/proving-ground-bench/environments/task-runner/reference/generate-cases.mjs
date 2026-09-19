#!/usr/bin/env node
/**
 * Regenerate `cases.json` by running the reference on a fixed corpus: the
 * hand-written corners carry weight 3, the seeded graphs weight 1. The corpus
 * and the generator are deterministic, so a rerun rewrites the same bytes.
 *
 * Every case runs from the task directory, because the corpus names workspace
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

const FILES = [
  'task build node build.js\ntask bundle node bundle.js\nneeds bundle build\nreads build data/files/a.txt data/files/b.txt\nwrites build data/files/out-a.txt\nreads bundle data/files/out-a.txt\nwrites bundle data/files/out-b.txt\n',
  'task a echo a\ntask b echo b\ntask c echo c\nneeds b a\nneeds c a b\n',
  'task a echo a\ntask b echo b\nneeds a b\nneeds b a\n',
  'task a echo a\nneeds a a\n',
  'task a echo a\ntask b echo b\ntask c echo c\nneeds b a\nneeds a c\nneeds c a\n',
  'task z echo z\ntask y echo y\ntask x echo x\nneeds x y\nneeds y z\n',
  '',
  '# nothing but a comment\n',
  'task a echo a\n',
  'task a echo a\nreads a data/files/a.txt\n',
  'task a echo a\nwrites a data/files/out-a.txt\n',
  'task a echo a\nreads a data/files/gone.txt\n',
  'task a echo a\nreads a data/files/a.txt data/files/a.txt\nwrites a data/files/a.txt\n',
  'task a echo a\ntask b echo b\nneeds b a\nreads a data/files/a.txt\nwrites a data/files/out-a.txt\nreads b data/files/out-a.txt\n',
  'task a echo a\ntask b echo b\ntask c echo c\nneeds b a\nneeds c b\nreads a data/files/a.txt\n',
  'task a echo a\ntask b echo b\ntask c echo c\nneeds c a b\nreads a data/files/a.txt\nreads b data/files/b.txt\n',
  'reads b data/files/a.txt\ntask b echo b\n',
  'needs b a\ntask a echo a\ntask b echo b\n',
  'task a-1 echo a\ntask a.2 echo b\ntask a_3 echo c\nneeds a.2 a-1\nneeds a_3 a.2\n',
  'task a   echo    spaced   out  \n',
  'task a echo a\nneeds a ghost\n',
  'task a echo a\nreads ghost data/files/a.txt\n',
  'task a\n',
  'task a! echo a\n',
  'task a echo a\ntask a echo b\n',
  'task a echo a\nrun a\n',
  'task a echo a\nneeds a\n',
  'task a echo a\nreads a\n',
  'task a echo a\nwrites a\n',
  'task a echo a\nreads a! data/files/a.txt\n',
  'task a echo a\nreads a ../etc/passwd\n',
  'task a echo a\nreads a /etc/passwd\n',
  'task a echo a\nreads a data/files/a!.txt\n',
  'task a echo a\nneeds a b!\n',
  'task b echo b\ntask a echo a\nneeds b a\nreads a data/files/c.txt\nwrites b data/files/out-b.txt\n',
]

const SNAPSHOTS = [
  'data/snapshots/current.snap',
  'data/snapshots/stale-a.snap',
  'data/snapshots/stale-out.snap',
  'data/snapshots/partial.snap',
  'data/snapshots/gone.snap',
  'data/snapshots/empty.snap',
  'data/snapshots/bad-line.snap',
  'data/snapshots/bad-digest.snap',
  'data/snapshots/short-digest.snap',
  'data/snapshots/twice.snap',
  'data/snapshots/nope.snap',
]

const PATHS = ['data/files/a.txt', 'data/files/b.txt', 'data/files/c.txt', 'data/files/out-a.txt', 'data/files/out-b.txt', 'data/files/gone.txt']
const NAMES = ['a', 'b', 'c', 'build', 'bundle', 'ghost', 'x', 'y', 'z']
const BAD_ARGV = [[], ['sweep'], ['order', 'extra'], ['show'], ['show', 'a', 'b'], ['files'], ['files', 'a', 'b'], ['plan'], ['plan', 'a', 'b'], ['digest']]

const cases = []
const push = (weight, argv, stdin) => {
  cases.push({ id: `${weight === 3 ? 'corner' : 'seeded'}-${String(cases.length + 1).padStart(3, '0')}`, weight, argv, stdin })
}

for (const stdin of FILES) {
  push(3, ['order'], stdin)
  push(3, ['files', 'a'], stdin)
}
for (const snapshot of SNAPSHOTS) push(3, ['plan', snapshot], FILES[0])
for (const snapshot of SNAPSHOTS.slice(0, 6)) push(3, ['plan', snapshot], FILES[13])
for (const argv of BAD_ARGV) push(3, argv, FILES[0])
for (const path of PATHS) push(3, ['digest', path], '')
push(3, ['digest', ...PATHS], '')
for (const name of ['build', 'bundle', 'ghost']) push(3, ['show', name], FILES[0])
for (const name of ['build', 'bundle', 'ghost']) push(3, ['files', name], FILES[0])

const draw = rng(20260919)
const MODES = [['order'], ['plan', 'data/snapshots/current.snap'], ['plan', 'data/snapshots/partial.snap'], ['plan', 'data/snapshots/stale-a.snap'], ['plan', 'data/snapshots/gone.snap']]
const seeded = new Set()
while (cases.length < 140) {
  const count = 2 + draw(4)
  const names = NAMES.slice(0, count)
  const body = names.map(name => `task ${name} echo ${name}`)
  for (const name of names) {
    if (draw(3) === 0) continue
    const need = names[draw(names.length)]
    if (need !== name || draw(6) === 0) body.push(`needs ${name} ${need}`)
  }
  for (const name of names) {
    if (draw(2) === 0) body.push(`reads ${name} ${PATHS[draw(PATHS.length)]}`)
    if (draw(3) === 0) body.push(`writes ${name} ${PATHS[draw(PATHS.length)]}`)
  }
  const stdin = `${body.join('\n')}\n`
  const argv = MODES[draw(MODES.length)]
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
