#!/usr/bin/env node
/**
 * Regenerate `cases.json` by running the reference on a fixed corpus: the
 * hand-written corners carry weight 3, the seeded documents weight 1. The
 * corpus and the generator are deterministic, so a rerun rewrites the same
 * bytes.
 *
 * Every case runs from the task directory, because the corpus names the
 * definition files under `data/` and the runner starts a cased check there too.
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

const DOCUMENTS = [
  '- one\n  - inner\n    - deeper\n- two\n',
  '- one\n   - odd\n- two\n',
  '- one\n      - jump\n',
  '  - lonely\n',
  '- a\n- b\n  - c\n  - d\n- e\n',
  '- a\n  - b\n- c\n  - d\n    - e\n  - f\n',
  '- a\n\n  - b\n',
  'text\n- not an item\n',
  'see [Home][home] and [Docs][] and [x][nope]\n',
  '[two   WORDS][]\n',
  '[q][quote]\n',
  '[Local]: /l\n\nsee [it][local]\n',
  '[Local]:    /l\n[other]: /o\n\n[a][local] [b][OTHER]\n',
  'text\n[a]: /a\nmore\n',
  '[home]: /x\n',
  '[home]: /x\n[home]: /y\n',
  '[]: /x\n',
  '[a]:\n',
  '[a]: \n',
  '[*em*][home]\n',
  '[`code`][home]\n',
  '[a\\]b][home]\n',
  '[nope][]\n',
  '[home][home][home]\n',
  '```html\n<b>&amp;</b>\n```\n',
  '```h<i>\na\n```\n',
  '```  js  extra\nx\n```\n',
  '```\n<a href="x">&\n```\n',
  '```\n```\n',
  '````\n```\n````\n',
  '# A & B\n\n- <b>\n\n> quoted\n',
  '- [Home][home]\n  - [Docs][]\n',
  '# [Home][home]\n',
  '',
  '# only\n',
  'a\nb\n\n- c\n  - d\n\n```\ne\n```\n',
]

const FILES = [[], ['data/site.links'], ['data/empty.links'], ['data/bad.links'], ['data/twice.links'], ['data/nope.links']]
const MODES = ['html', 'outline', 'defs']
const BAD_ARGV = [[], ['render'], ['html', 'data/site.links', 'x'], ['HTML']]

const cases = []
const push = (weight, argv, stdin) => {
  cases.push({ id: `${weight === 3 ? 'corner' : 'seeded'}-${String(cases.length + 1).padStart(3, '0')}`, weight, argv, stdin })
}

for (const document of DOCUMENTS) {
  push(3, ['html', 'data/site.links'], document)
  push(3, ['defs', 'data/site.links'], document)
}
for (const file of FILES) {
  for (const mode of MODES) push(3, [mode, ...file], DOCUMENTS[11])
}
for (const argv of BAD_ARGV) push(3, argv, DOCUMENTS[0])

const LINES = [
  '# Head',
  '## Sub',
  'plain text',
  'a & b < c',
  '- item',
  '  - nested',
  '    - deep',
  '',
  '```',
  '```js',
  '<b>tag</b>',
  '[Home][home]',
  '[Docs][]',
  '[gone][]',
  '[x](y)',
  '*em* **strong** `code`',
  '[label]: /url',
  '[Other]: /other',
  '\\[escaped\\]',
]
const draw = rng(20260919)
const seeded = new Set()
while (cases.length < 150) {
  const count = 2 + draw(6)
  const body = []
  for (let index = 0; index < count; index += 1) body.push(LINES[draw(LINES.length)])
  const stdin = `${body.join('\n')}\n`
  const argv = [MODES[draw(MODES.length)], ...FILES[draw(3)]]
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
