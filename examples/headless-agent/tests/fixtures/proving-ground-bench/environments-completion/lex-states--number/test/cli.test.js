import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url))

function run(argv, stdin = '') {
  const result = spawnSync(process.execPath, [cli, ...argv], { encoding: 'utf8', input: stdin })
  return { code: result.status, out: result.stdout, err: result.stderr }
}

test('an identifier and a keyword are told apart', () => {
  assert.deepEqual(run(['tokens'], 'let x\n'), { code: 0, out: '1:1 keyword let\n1:5 ident x\n', err: '' })
})

test('columns count from one and whitespace is skipped', () => {
  assert.equal(run(['tokens'], 'a  b\n').out, '1:1 ident a\n1:4 ident b\n')
})

test('a new line restarts the column count', () => {
  assert.equal(run(['tokens'], 'a\nb\n').out, '1:1 ident a\n2:1 ident b\n')
})

test('a decimal number is one token', () => {
  assert.equal(run(['tokens'], '12.5\n').out, '1:1 number 12.5\n')
})

test('a hexadecimal number keeps its prefix', () => {
  assert.equal(run(['tokens'], '0x1F\n').out, '1:1 number 0x1F\n')
})

test('a two-character operator wins over its first character', () => {
  assert.equal(run(['tokens'], '>=\n').out, '1:1 punct >=\n')
})

test('a string prints its decoded value quoted', () => {
  assert.equal(run(['tokens'], '"a\\tb"\n').out, '1:1 string "a\\tb"\n')
})

test('a raw string keeps its backslashes', () => {
  assert.equal(run(['tokens'], 'r"a\\tb"\n').out, '1:1 rawstring "a\\\\tb"\n')
})

test('a line comment runs to the end of its line', () => {
  assert.equal(run(['tokens'], 'a // b\nc\n').out, '1:1 ident a\n2:1 ident c\n')
})

test('a block comment is skipped', () => {
  assert.equal(run(['tokens'], 'a /* b */ c\n').out, '1:1 ident a\n1:11 ident c\n')
})

test('stats count every kind, including the ones with nothing', () => {
  assert.deepEqual(run(['stats'], 'let a = 1\n'), {
    code: 0,
    out: 'ident 1\nkeyword 1\nnumber 1\npunct 1\nrawstring 0\nstring 0\ntotal 4\n',
    err: '',
  })
})

test('empty input has no token', () => {
  assert.deepEqual(run(['tokens'], ''), { code: 0, out: '', err: '' })
})

test('a string the input never closes is reported at its opening quote', () => {
  const result = run(['tokens'], '"abc')
  assert.equal(result.code, 2)
  assert.equal(result.out, '')
  assert.equal(result.err, 'error: 1:1: unterminated string\n')
})

test('an unterminated block comment is reported at its opening', () => {
  assert.equal(run(['tokens'], 'a /* b\n').err, 'error: 1:3: unterminated block comment\n')
})

test('a character the language does not use is rejected', () => {
  assert.equal(run(['tokens'], 'a $ b\n').err, 'error: 1:3: unexpected character $\n')
})

test('an unknown mode is rejected', () => {
  const result = run(['scan'], '')
  assert.equal(result.code, 2)
  assert.equal(result.err, 'error: usage: cli.js tokens|stats\n')
})
