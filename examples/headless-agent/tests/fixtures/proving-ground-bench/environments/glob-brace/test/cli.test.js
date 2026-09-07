import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url))

function run(argv, stdin = '') {
  const result = spawnSync(process.execPath, [cli, ...argv], { encoding: 'utf8', input: stdin })
  return { code: result.status, out: result.stdout, err: result.stderr }
}

function expand(pattern) {
  return run(['expand'], `${pattern}\n`).out
}

function match(pattern, ...paths) {
  return run(['match'], `${pattern}\n${paths.join('\n')}\n`).out
}

test('expands a comma list in order', () => {
  assert.deepEqual(run(['expand'], 'a{b,c}d\n'), { code: 0, out: 'abd\nacd\n', err: '' })
})

test('expands two groups as a product, leftmost group outermost', () => {
  assert.equal(expand('{a,b}{c,d}'), 'ac\nad\nbc\nbd\n')
})

test('expands a nested group', () => {
  assert.equal(expand('x{a,{b,c}y}z'), 'xaz\nxbyz\nxcyz\n')
})

test('expands an ascending integer range', () => {
  assert.equal(expand('{1..4}'), '1\n2\n3\n4\n')
})

test('expands a letter range', () => {
  assert.equal(expand('{a..d}'), 'a\nb\nc\nd\n')
})

test('a group with neither a comma nor a range stays literal', () => {
  assert.equal(expand('{a}b'), '{a}b\n')
})

test('a pattern with no group expands to itself', () => {
  assert.equal(expand('plain/path.js'), 'plain/path.js\n')
})

test('a star matches inside one segment only', () => {
  assert.equal(match('*.js', 'a.js', 'b/c.js', 'xjs'), '+ a.js\n- b/c.js\n- xjs\n')
})

test('a question mark matches exactly one character', () => {
  assert.equal(match('a?c', 'abc', 'ac', 'abbc'), '+ abc\n- ac\n- abbc\n')
})

test('a bracket range matches one character of the range', () => {
  assert.equal(match('[a-c]x', 'ax', 'cx', 'dx'), '+ ax\n+ cx\n- dx\n')
})

test('a globstar segment spans any number of segments', () => {
  assert.equal(match('a/**/b', 'a/b', 'a/x/b', 'a/x/y/b'), '+ a/b\n+ a/x/b\n+ a/x/y/b\n')
})

test('an at-group matches exactly one alternative', () => {
  assert.equal(match('@(a|bb)c', 'ac', 'bbc', 'bc'), '+ ac\n+ bbc\n- bc\n')
})

test('a bang-group matches anything but its alternatives', () => {
  assert.equal(match('!(foo).js', 'foo.js', 'bar.js'), '- foo.js\n+ bar.js\n')
})

test('a backslash makes the next character literal', () => {
  assert.equal(match('\\*', '*', 'a'), '+ *\n- a\n')
})

test('the pattern is brace-expanded before it matches', () => {
  assert.equal(match('*.{js,ts}', 'a.js', 'a.ts', 'a.tsx'), '+ a.js\n+ a.ts\n- a.tsx\n')
})

test('an unknown mode is rejected', () => {
  const result = run(['glob'], '')
  assert.equal(result.code, 2)
  assert.equal(result.out, '')
  assert.equal(result.err, 'error: usage: cli.js expand|match\n')
})

test('a pattern with no paths prints nothing and succeeds', () => {
  assert.deepEqual(run(['match'], '*.js\n'), { code: 0, out: '', err: '' })
})
