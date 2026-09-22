import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url))

function run(argv, stdin = '') {
  const result = spawnSync(process.execPath, [cli, ...argv], { encoding: 'utf8', input: stdin })
  return { code: result.status, out: result.stdout, err: result.stderr }
}

test('a bucket allows up to its capacity and then denies', () => {
  const input = 'bucket b 2 1 3\nroute k b\nevent 0 k1\nevent 0 k1\nevent 0 k1\n'
  assert.deepEqual(run(['replay'], input), { code: 0, out: '0 k1 allow\n0 k1 allow\n0 k1 deny b\n', err: '' })
})

test('a bucket refills over time', () => {
  const input = 'bucket b 1 1 2\nroute k b\nevent 0 k1\nevent 1 k1\nevent 2 k1\n'
  assert.equal(run(['replay'], input).out, '0 k1 allow\n1 k1 deny b\n2 k1 allow\n')
})

test('every key has its own bucket', () => {
  const input = 'bucket b 1 1 5\nroute k b\nevent 0 k1\nevent 0 k2\n'
  assert.equal(run(['replay'], input).out, '0 k1 allow\n0 k2 allow\n')
})

test('a window allows its limit inside its span', () => {
  const input = 'window w 2 4\nroute k w\nevent 0 k1\nevent 1 k1\nevent 2 k1\nevent 4 k1\n'
  assert.equal(run(['replay'], input).out, '0 k1 allow\n1 k1 allow\n2 k1 deny w\n4 k1 allow\n')
})

test('a key no route matches is always allowed', () => {
  assert.equal(run(['replay'], 'bucket b 1 0 1\nroute k b\nevent 0 other\nevent 0 other\n').out, '0 other allow\n0 other allow\n')
})

test('the longest matching route prefix wins', () => {
  const input = 'bucket wide 5 0 1\nbucket tight 1 0 1\nroute a wide\nroute ab tight\nevent 0 abc\nevent 0 abc\n'
  assert.equal(run(['replay'], input).out, '0 abc allow\n0 abc deny tight\n')
})

test('a route with two policies denies by the first that refuses', () => {
  const input = 'bucket b 5 0 1\nwindow w 1 9\nroute k b w\nevent 0 k1\nevent 0 k1\n'
  assert.equal(run(['replay'], input).out, '0 k1 allow\n0 k1 deny w\n')
})

test('a denied event consumes nothing', () => {
  const input = 'window w 1 3\nroute k w\nevent 0 k1\nevent 1 k1\nevent 3 k1\n'
  assert.equal(run(['replay'], input).out, '0 k1 allow\n1 k1 deny w\n3 k1 allow\n')
})

test('summary totals the verdicts per key and overall', () => {
  const input = 'bucket b 1 0 1\nroute k b\nevent 0 k1\nevent 0 k1\nevent 0 k2\n'
  assert.deepEqual(run(['summary'], input), { code: 0, out: 'k1 allowed=1 denied=1\nk2 allowed=1 denied=0\ntotal allowed=2 denied=1\n', err: '' })
})

test('an empty log reports zero totals', () => {
  assert.equal(run(['summary'], '').out, 'total allowed=0 denied=0\n')
})

test('blank lines and comments are ignored', () => {
  assert.equal(run(['summary'], '# note\n\nbucket b 1 0 1\nroute k b\nevent 0 k1\n').out, 'k1 allowed=1 denied=0\ntotal allowed=1 denied=0\n')
})

test('an event before an earlier tick is rejected', () => {
  const result = run(['replay'], 'bucket b 1 0 1\nroute k b\nevent 3 k1\nevent 1 k1\n')
  assert.equal(result.code, 2)
  assert.equal(result.out, '')
  assert.equal(result.err, 'error: line 4: tick 1 is before tick 3\n')
})

test('a route naming an undeclared policy is rejected', () => {
  assert.equal(run(['replay'], 'route k ghost\n').err, 'error: line 1: unknown policy ghost\n')
})

test('a declaration after the first event is rejected', () => {
  assert.equal(run(['replay'], 'bucket b 1 0 1\nroute k b\nevent 0 k1\nwindow w 1 1\n').err, 'error: line 4: declarations must come before the first event\n')
})

test('a policy declared twice is rejected', () => {
  assert.equal(run(['replay'], 'bucket b 1 0 1\nwindow b 1 1\n').err, 'error: line 2: policy b is declared twice\n')
})

test('an unknown directive is rejected', () => {
  assert.equal(run(['replay'], 'limit b 1\n').err, 'error: line 1: unknown directive limit\n')
})

test('an unknown mode is rejected', () => {
  const result = run(['simulate'], '')
  assert.equal(result.code, 2)
  assert.equal(result.err, 'error: usage: cli.js replay|summary\n')
})
