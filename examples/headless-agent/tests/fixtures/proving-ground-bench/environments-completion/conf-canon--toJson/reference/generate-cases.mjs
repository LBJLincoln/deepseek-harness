#!/usr/bin/env node
/**
 * Regenerate `cases.json` by running the reference on a fixed corpus: the
 * hand-written corners carry weight 3, the seeded documents weight 1. The
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

const DOCUMENTS = [
  '# a comment\nzeta = 1\nalpha = "a\\tbA"\nflag = true\nnum = 1_000\npi = 3.14\nsci = 1e3\nlit = \'raw\\nnot\'\narr = [1, 2, [3, 4], ]\ninline = { x = 1, y.z = "q" }\n\n[server]\nhost = "example.com"\nport = 8080\n\n[server.tls]\non = false\n\n[[items]]\nname = "one"\n\n[[items]]\nname = "two"\n\n[a."b c"]\nd = 1\n',
  'a = 1\nb = 1.0\nc = 1e0\nd = -0\ne = +1\nf = 1.5e-2\ng = 0\n',
  'a = 1__0\nb = _1\nc = 1_\nd = 1.\ne = .5\nf = 1e\n',
  'a = "\\u0041\\u00e9"\nb = "\\q"\nc = "no end\nd = \'\'\ne = ""\n',
  'a = []\nb = [[]]\nc = [1, "x", true, 2.5]\nd = [1,]\ne = [,]\nf = [1 2]\n',
  'a = {}\nb = { x = 1 }\nc = { x = 1, x = 2 }\nd = { x = 1,, }\ne = { x = }\n',
  '[a]\nx = 1\n[a.b]\ny = 2\n[a]\nz = 3\n',
  '[a.b]\nx = 1\n[a]\ny = 2\n',
  '[a]\nx = 1\n[a.b]\ny = 2\n',
  'a.b = 1\na.c = 2\n[a]\nd = 3\n',
  'a = 1\n[a]\nb = 2\n',
  '[a]\nb.c = 1\nb.d = 2\n',
  '[a]\nb = 1\nb.c = 2\n',
  '[[a]]\nx = 1\n[a.b]\ny = 2\n[[a]]\nx = 3\n',
  '[[a]]\n[[a]]\n[[a]]\n',
  'a = 1\n[[a]]\n',
  '["quoted key"]\nx = 1\n',
  "['single']\nx = 1\n",
  '[a] # trailing\nx = 1 ; other\n',
  '[a] junk\n',
  'x = 1 junk\n',
  '[a\n',
  '[[a]\n',
  '[]\n',
  'x =\n',
  'x 1\n',
  '= 1\n',
  '',
  '\n\n#\n;\n   \n',
  'Z = 1\na = 2\nB = 3\nb = 4\n_ = 5\n-x = 6\n',
  'x = "a#b"\ny = 1 #c\nz = 1#c\n',
  'deep.a.b.c.d = 1\n[deep.a]\ne = 2\n',
]

const MODES = [['json'], ['keys']]
const BAD = [[['toml'], 'a = 1\n'], [[], 'a = 1\n'], [['json', 'keys'], 'a = 1\n']]

const draw = rng(20260907)
const cases = []
const push = (weight, argv, stdin) => {
  cases.push({ id: `${weight === 3 ? 'corner' : 'seeded'}-${String(cases.length + 1).padStart(3, '0')}`, weight, argv, stdin })
}
for (const stdin of DOCUMENTS) {
  for (const argv of MODES) push(3, argv, stdin)
}
for (const [argv, stdin] of BAD) push(3, argv, stdin)

const KEYS = ['a', 'b', 'c.d', 'e', '"f g"', 'h']
const VALUES = ['1', '2.5', 'true', '"s"', "'r'", '[1, 2]', '{ x = 1 }', '1_0', '1e2', 'false', '[]', '{}']
const HEADERS = ['[t]', '[t.u]', '[[v]]', '[w]']

const seeded = new Set()
while (cases.length < 150) {
  const body = []
  const size = 2 + draw(7)
  // Keys are drawn without replacement inside each header, so most seeded
  // documents reach the tree instead of stopping at a duplicate.
  let used = new Set()
  const headers = new Set()
  for (let index = 0; index < size; index += 1) {
    if (draw(4) === 0) {
      const header = HEADERS[draw(HEADERS.length)]
      if (headers.has(header) && !header.startsWith('[[')) continue
      headers.add(header)
      body.push(header)
      used = new Set()
      continue
    }
    const key = KEYS[draw(KEYS.length)]
    if (used.has(key)) continue
    used.add(key)
    body.push(`${key} = ${VALUES[draw(VALUES.length)]}`)
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
