import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url))

function run(argv, stdin = '') {
  const result = spawnSync(process.execPath, [cli, ...argv], { encoding: 'utf8', input: stdin })
  return { code: result.status, out: result.stdout, err: result.stderr }
}

test('a literal number prints as itself', () => {
  assert.deepEqual(run(['values'], 'A1 3\n'), { code: 0, out: 'A1=3\n', err: '' })
})

test('a literal that is not a number is text', () => {
  assert.equal(run(['values'], 'A1 hello\n').out, 'A1=hello\n')
})

test('arithmetic follows the usual precedence', () => {
  assert.equal(run(['values'], 'A1 =1+2*3\n').out, 'A1=7\n')
})

test('parentheses override precedence', () => {
  assert.equal(run(['values'], 'A1 =(1+2)*3\n').out, 'A1=9\n')
})

test('a formula reads another cell', () => {
  assert.equal(run(['values'], 'A1 3\nA2 =A1+1\n').out, 'A1=3\nA2=4\n')
})

test('cells are printed by column and then by row', () => {
  assert.equal(run(['values'], 'B1 2\nA2 1\nA1 0\n').out, 'A1=0\nA2=1\nB1=2\n')
})

test('SUM adds a range', () => {
  assert.equal(run(['values'], 'A1 1\nA2 2\nA3 =SUM(A1:A2)\n').out, 'A1=1\nA2=2\nA3=3\n')
})

test('an undeclared cell reads as zero', () => {
  assert.equal(run(['values'], 'A1 =B9+5\n').out, 'A1=5\n')
})

test('dividing by zero yields the division error', () => {
  assert.equal(run(['values'], 'A1 =1/0\n').out, 'A1=#DIV/0!\n')
})

test('an error travels through the cells that read it', () => {
  assert.equal(run(['values'], 'A1 =1/0\nA2 =A1+1\n').out, 'A1=#DIV/0!\nA2=#DIV/0!\n')
})

test('text in an arithmetic position yields the value error', () => {
  assert.equal(run(['values'], 'A1 hi\nA2 =A1+1\n').out, 'A1=hi\nA2=#VALUE!\n')
})

test('a cell that reaches itself yields the cycle error', () => {
  assert.equal(run(['values'], 'A1 =A2\nA2 =A1\n').out, 'A1=#CYCLE!\nA2=#CYCLE!\n')
})

test('an unknown function yields the name error', () => {
  assert.equal(run(['values'], 'A1 =NOPE(1)\n').out, 'A1=#NAME?\n')
})

test('a comparison yields a boolean', () => {
  assert.equal(run(['values'], 'A1 =2>1\n').out, 'A1=TRUE\n')
})

test('deps list the cells a formula reads', () => {
  assert.deepEqual(run(['deps'], 'A1 1\nB1 =A1+C1\n'), { code: 0, out: 'A1:\nB1: A1 C1\n', err: '' })
})

test('an invalid cell address is rejected', () => {
  const result = run(['values'], 'AAA1 3\n')
  assert.equal(result.code, 2)
  assert.equal(result.out, '')
  assert.equal(result.err, 'error: line 1: invalid cell address AAA1\n')
})

test('a cell declared twice is rejected', () => {
  assert.equal(run(['values'], 'A1 1\nA1 2\n').err, 'error: line 2: cell A1 is declared twice\n')
})

test('an unknown mode is rejected', () => {
  const result = run(['calc'], '')
  assert.equal(result.code, 2)
  assert.equal(result.err, 'error: usage: cli.js values|deps\n')
})
