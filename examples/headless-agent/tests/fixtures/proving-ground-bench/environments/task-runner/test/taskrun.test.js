/** The repository's own suite, covering what `taskrun` already does. */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url))
const root = fileURLToPath(new URL('../', import.meta.url))

function run(argv, stdin = '') {
  const result = spawnSync(process.execPath, [cli, ...argv], { cwd: root, encoding: 'utf8', input: stdin })
  return { code: result.status, out: result.stdout, err: result.stderr }
}

const DAG = 'task a echo a\ntask b echo b\ntask c echo c\nneeds b a\nneeds c a b\n'

test('order emits a dependency before the task that needs it', () => {
  assert.deepEqual(run(['order'], DAG), { code: 0, out: 'a\nb\nc\n', err: '' })
})

test('order breaks ties by ascending name', () => {
  const input = 'task z echo z\ntask y echo y\ntask x echo x\n'
  assert.equal(run(['order'], input).out, 'x\ny\nz\n')
})

test('order accepts a needs line before the task it names', () => {
  const input = 'needs b a\ntask a echo a\ntask b echo b\n'
  assert.equal(run(['order'], input).out, 'a\nb\n')
})

test('an empty task file orders nothing', () => {
  assert.deepEqual(run(['order'], ''), { code: 0, out: '', err: '' })
})

test('comments and blank lines are ignored', () => {
  assert.equal(run(['order'], '# build\n\ntask a echo a\n').out, 'a\n')
})

test('show prints the command and the dependencies', () => {
  assert.equal(run(['show', 'c'], DAG).out, 'c: echo c\nneeds: a b\n')
})

test('show writes a dash for a task that needs nothing', () => {
  assert.equal(run(['show', 'a'], DAG).out, 'a: echo a\nneeds: -\n')
})

test('show refuses a name no task declares', () => {
  assert.deepEqual(run(['show', 'zz'], DAG), { code: 2, out: '', err: 'error: unknown task zz\n' })
})

test('a repeated dependency counts once', () => {
  assert.equal(run(['show', 'b'], 'task a echo a\ntask b echo b\nneeds b a\nneeds b a\n').out, 'b: echo b\nneeds: a\n')
})

test('digest prints the FNV-1a digest of each path in argument order', () => {
  assert.deepEqual(run(['digest', 'data/files/a.txt', 'data/files/b.txt']), {
    code: 0,
    out: 'data/files/a.txt e37d9473\ndata/files/b.txt 784f5257\n',
    err: '',
  })
})

test('digest reports a path that does not exist as missing', () => {
  assert.equal(run(['digest', 'data/files/nope.txt']).out, 'data/files/nope.txt missing\n')
})

test('a task line without a command is refused', () => {
  assert.deepEqual(run(['order'], 'task a\n'), { code: 2, out: '', err: 'error: line 1: expected task <name> <word>...\n' })
})

test('a needs line without a dependency is refused', () => {
  assert.equal(run(['order'], 'task a echo a\nneeds a\n').err, 'error: line 2: expected needs <name> <dependency>...\n')
})

test('an invalid task name names its line', () => {
  assert.equal(run(['order'], 'task a! echo a\n').err, 'error: line 1: invalid task name a!\n')
})

test('a task declared twice names its second line', () => {
  assert.equal(run(['order'], 'task a echo a\ntask a echo b\n').err, 'error: line 2: task a is declared twice\n')
})

test('an unknown directive names its line', () => {
  assert.equal(run(['order'], 'task a echo a\nrun a\n').err, 'error: line 2: unknown directive run\n')
})

test('a dependency no task declares is refused without a line number', () => {
  assert.equal(run(['order'], 'task a echo a\nneeds a ghost\n').err, 'error: unknown task ghost\n')
})
