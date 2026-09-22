import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url))

function run(argv, stdin = '') {
  const result = spawnSync(process.execPath, [cli, ...argv], { encoding: 'utf8', input: stdin })
  return { code: result.status, out: result.stdout, err: result.stderr }
}

test('resolves a relative reference against the base path', () => {
  assert.deepEqual(run(['resolve'], 'http://a/b/c/d;p?q g\n'), { code: 0, out: 'http://a/b/c/g\n', err: '' })
})

test('resolves an absolute reference unchanged', () => {
  assert.equal(run(['resolve'], 'http://a/b/c/d;p?q https://x/y\n').out, 'https://x/y\n')
})

test('resolves a rooted reference', () => {
  assert.equal(run(['resolve'], 'http://a/b/c/d;p?q /g\n').out, 'http://a/g\n')
})

test('resolves a parent reference', () => {
  assert.equal(run(['resolve'], 'http://a/b/c/d;p?q ../g\n').out, 'http://a/b/g\n')
})

test('a query-only reference keeps the base path', () => {
  assert.equal(run(['resolve'], 'http://a/b/c/d;p?q ?y\n').out, 'http://a/b/c/d;p?y\n')
})

test('a fragment-only reference keeps the base path and query', () => {
  assert.equal(run(['resolve'], 'http://a/b/c/d;p?q #s\n').out, 'http://a/b/c/d;p?q#s\n')
})

test('resolves every line of the input in order', () => {
  const out = run(['resolve'], 'http://a/b/ x\nhttp://a/b/ y\n').out
  assert.equal(out, 'http://a/b/x\nhttp://a/b/y\n')
})

test('normalize lowercases the scheme and the host', () => {
  assert.equal(run(['normalize'], 'HTTP://ExAmPle.COM/a\n').out, 'http://example.com/a\n')
})

test('normalize removes dot segments from the path', () => {
  assert.equal(run(['normalize'], 'http://a/x/./y/../z\n').out, 'http://a/x/z\n')
})

test('normalize drops the default port of the scheme', () => {
  assert.equal(run(['normalize'], 'https://a:443/x\n').out, 'https://a/x\n')
})

test('normalize keeps a port that is not the default', () => {
  assert.equal(run(['normalize'], 'http://a:8080/x\n').out, 'http://a:8080/x\n')
})

test('normalize decodes a percent-encoded unreserved character', () => {
  assert.equal(run(['normalize'], 'http://a/%7Euser\n').out, 'http://a/~user\n')
})

test('normalize uppercases the hex digits it keeps', () => {
  assert.equal(run(['normalize'], 'http://a/%3a\n').out, 'http://a/%3A\n')
})

test('an unknown mode is rejected', () => {
  const result = run(['upgrade'], '')
  assert.equal(result.code, 2)
  assert.equal(result.out, '')
  assert.equal(result.err, 'error: usage: cli.js normalize|resolve\n')
})

test('a base without a scheme is rejected', () => {
  const result = run(['resolve'], 'a/b c\n')
  assert.equal(result.code, 2)
  assert.equal(result.err, 'error: line 1: the base has no scheme\n')
})

test('empty input prints nothing and succeeds', () => {
  assert.deepEqual(run(['normalize'], ''), { code: 0, out: '', err: '' })
})
