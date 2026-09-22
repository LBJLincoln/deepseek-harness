#!/usr/bin/env node
/**
 * Regenerate `cases.json` by running the reference on a fixed corpus: the
 * hand-written corners carry weight 3, the seeded combinations weight 1. The
 * corpus and the generator are deterministic, so a rerun rewrites the same
 * bytes; the expectations are whatever the reference prints.
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

const EXPANSIONS = [
  'a{b,c}d', '{1..5}', '{5..1}', '{1..9..2}', '{01..10}', '{001..10}', '{-3..3}', '{3..-3..2}',
  '{a..e}', '{e..a}', '{a..e..2}', '{A..d}', '{a}', '{}', '{a,}', '{,a}', '{,}',
  'x{a,{b,c}y}z', 'a{b,c}{d,e}', '\\{a,b\\}', '{a,b', 'a}b', '{1..3}{a,b}', '{0..0}',
  '{1..2..0}', 'pre{x,y}post', '{a,b}/{c,d}', '{x{1..2},y}', 'no-braces', '{2..-2}',
  '{a..c}{1..2}', '{01..3}', '{10..1..4}', 'a{,b}c', '{{a,b},c}', '{a,b\\,c}', '{}{a,b}',
]

const MATCHES = [
  ['*.js', ['a.js', '.a.js', 'b/c.js', 'xjs', 'a.js.js', '.js']],
  ['*', ['a', '.a', 'a/b', '']],
  ['?', ['a', 'ab', '.', '']],
  ['a?c', ['abc', 'a/c', 'ac', 'abbc']],
  ['**', ['a', 'a/b', 'a/b/c', '.a', 'a/.b']],
  ['**/*.js', ['a.js', 'x/y/z.js', 'x/.h/z.js', '.x/z.js', 'x/y.js']],
  ['a/**/b', ['a/b', 'a/x/b', 'a/x/y/b', 'a/.x/b', 'ab']],
  ['**/**', ['a', 'a/b', '']],
  ['a**b', ['ab', 'axb', 'a/b']],
  ['[abc]x', ['ax', 'bx', 'dx', '[x']],
  ['[a-c]x', ['ax', 'cx', 'dx', 'Bx']],
  ['[!a-c]x', ['dx', 'ax', '-x', '/x']],
  ['[^a-c]x', ['dx', 'ax']],
  ['a[]]b', ['a]b', 'ab']],
  ['a[!]]b', ['a]b', 'axb']],
  ['a[-x]b', ['a-b', 'axb', 'ayb']],
  ['a[x-]b', ['a-b', 'axb']],
  ['[\\]]x', [']x', '\\x']],
  ['?(a|b)c', ['c', 'ac', 'bc', 'abc']],
  ['*(ab)c', ['c', 'abc', 'ababc', 'abac']],
  ['+(ab)c', ['c', 'abc', 'ababc']],
  ['@(a|bb)c', ['ac', 'bbc', 'c', 'bc']],
  ['!(foo|bar).js', ['foo.js', 'bar.js', 'baz.js', '.js', 'foobar.js']],
  ['!(foo)', ['foo', 'bar', '', 'foof']],
  ['x!(a)y', ['xy', 'xby', 'xay', 'xaay']],
  ['@(a|!(b))c', ['ac', 'bc', 'dc']],
  ['*(a|b)*(c)', ['', 'abc', 'cc', 'abd']],
  ['+(a|b)/c', ['a/c', 'ab/c', '/c']],
  ['\\*', ['*', 'a', '\\a']],
  ['\\?x', ['?x', 'ax']],
  ['a\\/b', ['a/b', 'ab']],
  ['{a,b}*.js', ['ax.js', 'b.js', 'c.js']],
  ['{**/,}*.js', ['a.js', 'x/a.js', 'x/y/a.js']],
  ['.*', ['.a', 'a', '.']],
  ['.[ab]', ['.a', '.c']],
  ['a/.*/b', ['a/.x/b', 'a/x/b']],
  ['**/.*', ['.a', 'x/.a', 'x/y/.a', 'x/a']],
  ['[a-]x', ['ax', '-x', 'bx']],
  ['*.{js,ts}', ['a.js', 'a.ts', 'a.tsx']],
  ['?(*).js', ['.js', 'a.js', 'ab.js']],
]

const ERRORS = [
  ['expand', 'a{b,c}\nsecond\n'],
  ['expand', ''],
  ['match', ''],
  ['match', '[abc\nax\n'],
  ['match', 'a\\\nax\n'],
  ['match', '@(a|b\nax\n'],
  ['match', 'a[b\\\nax\n'],
]

const PATTERN_PARTS = ['a', 'b', '*', '?', '[a-c]', '@(x|y)', '!(z)', '.', '{p,q}', '**']
const PATHS = ['a/b', 'a', '.a', 'x/y/z', 'ab', 'a/.b/c', 'p', 'q', 'xy', 'z', '', 'a/b/c/d']

const draw = rng(20260907)
const cases = []
const push = (weight, argv, stdin) => {
  cases.push({ id: `${weight === 3 ? 'corner' : 'seeded'}-${String(cases.length + 1).padStart(3, '0')}`, weight, argv, stdin })
}
for (const pattern of EXPANSIONS) push(3, ['expand'], `${pattern}\n`)
for (const [pattern, paths] of MATCHES) push(3, ['match'], `${pattern}\n${paths.join('\n')}\n`)
for (const [mode, stdin] of ERRORS) push(3, [mode], stdin)

const seeded = new Set()
while (cases.length < 170) {
  const size = 1 + draw(3)
  let pattern = ''
  for (let index = 0; index < size; index += 1) {
    pattern += (index > 0 && draw(2) === 0 ? '/' : '') + PATTERN_PARTS[draw(PATTERN_PARTS.length)]
  }
  const mode = draw(5) === 0 ? 'expand' : 'match'
  const stdin = mode === 'expand'
    ? `${pattern}\n`
    : `${pattern}\n${Array.from({ length: 3 }, () => PATHS[draw(PATHS.length)]).join('\n')}\n`
  const key = `${mode} ${stdin}`
  if (seeded.has(key)) continue
  seeded.add(key)
  push(1, [mode], stdin)
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
