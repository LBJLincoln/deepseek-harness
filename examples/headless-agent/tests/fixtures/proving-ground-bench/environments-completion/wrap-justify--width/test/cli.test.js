import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url))
const FOX = 'the quick brown fox jumps over the lazy dog\n'

function run(argv, stdin = '') {
  const result = spawnSync(process.execPath, [cli, ...argv], { encoding: 'utf8', input: stdin })
  return { code: result.status, out: result.stdout, err: result.stderr }
}

test('wrap fills each line greedily up to the width', () => {
  assert.deepEqual(run(['wrap', '12'], FOX), { code: 0, out: 'the quick\nbrown fox\njumps over\nthe lazy dog\n', err: '' })
})

test('wrap joins words with exactly one space', () => {
  assert.equal(run(['wrap', '40'], 'a   b\t\tc\n').out, 'a b c\n')
})

test('wrap keeps paragraphs apart with one blank line', () => {
  assert.equal(run(['wrap', '8'], 'one two\n\n\nthree\n').out, 'one two\n\nthree\n')
})

test('wrap ignores blank lines around the text', () => {
  assert.equal(run(['wrap', '8'], '\n\nonly\n\n').out, 'only\n')
})

test('wrap re-flows lines that the input had already broken', () => {
  assert.equal(run(['wrap', '11'], 'alpha\nbeta gamma\ndelta\n').out, 'alpha beta\ngamma delta\n')
})

test('justify pads the interior gaps to the exact width', () => {
  assert.equal(run(['justify', '12'], FOX).out, 'the    quick\nbrown    fox\njumps   over\nthe lazy dog\n')
})

test('justify leaves the last line of a paragraph alone', () => {
  assert.equal(run(['justify', '10'], 'a b c\n').out, 'a b c\n')
})

test('justify leaves a one-word line alone', () => {
  assert.equal(run(['justify', '9'], 'alpha beta gamma\n').out, 'alpha\nbeta\ngamma\n')
})

test('a word longer than the width takes a line of its own', () => {
  assert.equal(run(['wrap', '5'], 'supercalifragilistic x\n').out, 'supercalifragilistic\nx\n')
})

test('a soft hyphen offers a break point and prints a hyphen', () => {
  assert.equal(run(['wrap', '8'], 'aaa hy\u00ADphen\u00ADation bbb\n').out, 'aaa hy-\nphen-\nation\nbbb\n')
})

test('an unused soft hyphen disappears from the output', () => {
  assert.equal(run(['wrap', '40'], 'hy\u00ADphen\n').out, 'hyphen\n')
})

test('a combining mark takes no column', () => {
  assert.equal(run(['wrap', '4'], 'a\u0301bcd e\n').out, 'a\u0301bcd\ne\n')
})

test('a wide character takes two columns', () => {
  assert.equal(run(['wrap', '4'], '\u6F22\u5B57 ab\n').out, '\u6F22\u5B57\nab\n')
})

test('empty input prints nothing and succeeds', () => {
  assert.deepEqual(run(['wrap', '10'], ''), { code: 0, out: '', err: '' })
})

test('an unknown mode is rejected', () => {
  const result = run(['fill', '10'], '')
  assert.equal(result.code, 2)
  assert.equal(result.out, '')
  assert.equal(result.err, 'error: usage: cli.js wrap|justify <width>\n')
})

test('a width of zero is rejected', () => {
  assert.equal(run(['wrap', '0'], '').err, 'error: width must be a positive integer\n')
})
