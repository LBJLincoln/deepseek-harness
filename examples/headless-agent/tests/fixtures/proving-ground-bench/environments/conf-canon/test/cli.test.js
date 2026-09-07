import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url))

function run(argv, stdin = '') {
  const result = spawnSync(process.execPath, [cli, ...argv], { encoding: 'utf8', input: stdin })
  return { code: result.status, out: result.stdout, err: result.stderr }
}

test('a scalar assignment becomes one JSON member', () => {
  assert.deepEqual(run(['json'], 'a = 1\n'), { code: 0, out: '{\n  "a": 1\n}\n', err: '' })
})

test('members print in ascending key order', () => {
  assert.equal(run(['json'], 'b = 1\na = 2\n').out, '{\n  "a": 2,\n  "b": 1\n}\n')
})

test('a basic string decodes its escapes', () => {
  assert.equal(run(['json'], 'a = "x\\ty"\n').out, '{\n  "a": "x\\ty"\n}\n')
})

test('a literal string keeps its backslashes', () => {
  assert.equal(run(['json'], "a = 'x\\ty'\n").out, '{\n  "a": "x\\\\ty"\n}\n')
})

test('booleans are booleans', () => {
  assert.equal(run(['json'], 'a = true\nb = false\n').out, '{\n  "a": true,\n  "b": false\n}\n')
})

test('an integer may carry underscore separators', () => {
  assert.equal(run(['json'], 'a = 1_000\n').out, '{\n  "a": 1000\n}\n')
})

test('an array holds its items in order', () => {
  assert.equal(run(['json'], 'a = [1, 2]\n').out, '{\n  "a": [\n    1,\n    2\n  ]\n}\n')
})

test('a table header nests the keys under it', () => {
  assert.equal(run(['json'], '[s]\na = 1\n').out, '{\n  "s": {\n    "a": 1\n  }\n}\n')
})

test('a dotted header nests two levels', () => {
  assert.equal(run(['json'], '[s.t]\na = 1\n').out, '{\n  "s": {\n    "t": {\n      "a": 1\n    }\n  }\n}\n')
})

test('a doubled header appends to an array of tables', () => {
  assert.equal(run(['json'], '[[i]]\na = 1\n[[i]]\na = 2\n').out, '{\n  "i": [\n    {\n      "a": 1\n    },\n    {\n      "a": 2\n    }\n  ]\n}\n')
})

test('comments and blank lines are ignored', () => {
  assert.equal(run(['json'], '# note\n\na = 1 # tail\n').out, '{\n  "a": 1\n}\n')
})

test('an empty document is an empty object', () => {
  assert.deepEqual(run(['json'], ''), { code: 0, out: '{}\n', err: '' })
})

test('keys list every path with its type', () => {
  assert.equal(run(['keys'], '[s]\na = 1\nb = "x"\n').out, 's table\ns.a integer\ns.b string\n')
})

test('keys tell an integer from a float', () => {
  assert.equal(run(['keys'], 'a = 1\nb = 1.5\n').out, 'a integer\nb float\n')
})

test('a key defined twice is rejected', () => {
  const result = run(['json'], 'a = 1\na = 2\n')
  assert.equal(result.code, 2)
  assert.equal(result.out, '')
  assert.equal(result.err, 'error: line 2: key a is defined twice\n')
})

test('a table header used twice is rejected', () => {
  assert.equal(run(['json'], '[s]\n[s]\n').err, 'error: line 2: table s is defined twice\n')
})

test('a value that parses as nothing is rejected', () => {
  assert.equal(run(['json'], 'a = nope\n').err, 'error: line 1: invalid value nope\n')
})

test('an unknown mode is rejected', () => {
  const result = run(['toml'], '')
  assert.equal(result.code, 2)
  assert.equal(result.err, 'error: usage: cli.js json|keys\n')
})
