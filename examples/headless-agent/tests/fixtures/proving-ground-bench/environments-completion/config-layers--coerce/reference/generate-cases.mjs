#!/usr/bin/env node
/**
 * Regenerate `cases.json` by running the reference on a fixed corpus: the
 * hand-written corners carry weight 3, the seeded environment layers weight 1.
 * The corpus and the generator are deterministic, so a rerun rewrites the same
 * bytes.
 *
 * Every case runs from the task directory, because the corpus names the INI
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

const INI = [
  'data/base.ini',
  'data/site.ini',
  'data/empty.ini',
  'data/blank.ini',
  'data/unknown.ini',
  'data/bad-type.ini',
  'data/bad-line.ini',
  'data/dup.ini',
  'data/unterminated.ini',
  'data/nope.ini',
]

const ENVS = [
  '',
  '# nothing\n',
  'CONF_SERVER_PORT=8443\nCONF_LOG_LEVEL=debug\n',
  'CONF_TAGS=one, two ,one,three\n',
  'CONF_TAGS=\n',
  'CONF_TAGS=,\n',
  'CONF_TAGS=a,,b\n',
  'CONF_SERVER_TIMEOUT=0s\n',
  'CONF_SERVER_TIMEOUT=1h\n',
  'CONF_SERVER_TIMEOUT=90m\n',
  'CONF_SERVER_TIMEOUT=30\n',
  'CONF_SERVER_TIMEOUT=-5s\n',
  'CONF_RETRY_ATTEMPTS=-1\n',
  'CONF_RETRY_ATTEMPTS=007\n',
  'CONF_RETRY_ATTEMPTS=0\n',
  'CONF_SERVER_TLS=True\n',
  'CONF_SERVER_TLS=1\n',
  'CONF_LOG_LEVEL=quiet\n',
  'CONF_LOG_LEVEL=INFO\n',
  'CONF_LOG_FILE=  spaced  out  \n',
  'CONF_SERVER_PORT=\n',
  'CONF_SERVER_PORT =  80  \n',
  '  CONF_SERVER_PORT=80\n',
  '  CONF_TAGS\n',
  '=80\n',
  'HOME=/root\n',
  'conf_tags=a\n',
  'CONF_TAGS=a\n# again\nCONF_TAGS=b\n',
  'CONF_TAGS=a=b\n',
  'CONF_SERVER_HOST=a.test\nCONF_SERVER_PORT=1\nCONF_SERVER_TLS=false\nCONF_LOG_ROTATE=false\n',
]

const MODES = ['load', 'origin']
const PAIRS = [
  ['data/base.ini', 'data/site.ini'],
  ['data/empty.ini', 'data/empty.ini'],
  ['data/base.ini', 'data/empty.ini'],
  ['data/empty.ini', 'data/site.ini'],
  ['data/blank.ini', 'data/site.ini'],
  ['data/base.ini', 'data/bad-type.ini'],
  ['data/unknown.ini', 'data/empty.ini'],
  ['data/empty.ini', 'data/unknown.ini'],
  ['data/bad-line.ini', 'data/unknown.ini'],
  ['data/nope.ini', 'data/site.ini'],
  ['data/base.ini', 'data/nope.ini'],
  ['data/dup.ini', 'data/empty.ini'],
  ['data/unterminated.ini', 'data/empty.ini'],
]

const BAD_ARGV = [[], ['sweep'], ['dump'], ['dump', 'data/base.ini', 'x'], ['get', 'data/base.ini'], ['load', 'data/base.ini'], ['origin'], ['load', 'data/base.ini', 'data/site.ini', 'x']]

const cases = []
const push = (weight, argv, stdin) => {
  cases.push({ id: `${weight === 3 ? 'corner' : 'seeded'}-${String(cases.length + 1).padStart(3, '0')}`, weight, argv, stdin })
}

for (const [base, site] of PAIRS) {
  for (const mode of MODES) push(3, [mode, base, site], ENVS[2])
}
for (const env of ENVS) push(3, ['load', 'data/empty.ini', 'data/empty.ini'], env)
for (const env of ENVS.slice(0, 12)) push(3, ['origin', 'data/base.ini', 'data/site.ini'], env)
for (const path of INI) push(3, ['dump', path], '')
for (const key of ['log.file', 'log.level', 'server.port', 'server.timeout', 'tags', 'server.colour']) {
  push(3, ['get', 'data/base.ini', key], '')
}
for (const argv of BAD_ARGV) push(3, argv, '')

const NAMES = ['CONF_LOG_FILE', 'CONF_LOG_LEVEL', 'CONF_LOG_ROTATE', 'CONF_RETRY_ATTEMPTS', 'CONF_RETRY_BACKOFF', 'CONF_SERVER_HOST', 'CONF_SERVER_PORT', 'CONF_SERVER_TIMEOUT', 'CONF_SERVER_TLS', 'CONF_TAGS', 'CONF_SERVER_COLOUR']
const VALUES = ['', '0', '1', '-2', '01', 'true', 'false', 'TRUE', 'info', 'trace', '5s', '5', '500ms', '2h30m', 'a,b', 'a, a ,b', ',a', 'x y', '=']
const draw = rng(20260919)
const seeded = new Set()
while (cases.length < 140) {
  const lines = []
  const count = 1 + draw(4)
  for (let index = 0; index < count; index += 1) {
    lines.push(`${NAMES[draw(NAMES.length)]}=${VALUES[draw(VALUES.length)]}`)
  }
  const stdin = `${lines.join('\n')}\n`
  const pair = PAIRS[draw(4)]
  const argv = [MODES[draw(MODES.length)], ...pair]
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
