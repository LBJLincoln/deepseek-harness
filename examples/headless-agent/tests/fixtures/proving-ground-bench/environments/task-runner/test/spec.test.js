/** The suite for the change this task asks for: file lists, cycles, and the plan. */

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

const GRAPH = [
  'task build node build.js',
  'task bundle node bundle.js',
  'needs bundle build',
  'reads build data/files/a.txt data/files/b.txt',
  'writes build data/files/out-a.txt',
  'reads bundle data/files/out-a.txt',
  'writes bundle data/files/out-b.txt',
  '',
].join('\n')

test('files prints the reads and the writes in ascending order', () => {
  assert.deepEqual(run(['files', 'build'], GRAPH), {
    code: 0,
    out: 'reads: data/files/a.txt data/files/b.txt\nwrites: data/files/out-a.txt\n',
    err: '',
  })
})

test('files writes a dash for a task that names no file', () => {
  assert.equal(run(['files', 'a'], 'task a echo a\n').out, 'reads: -\nwrites: -\n')
})

test('a repeated path counts once', () => {
  const input = 'task a echo a\nreads a data/files/a.txt\nreads a data/files/a.txt\n'
  assert.equal(run(['files', 'a'], input).out, 'reads: data/files/a.txt\nwrites: -\n')
})

test('an invalid path names its line', () => {
  assert.equal(run(['files', 'a'], 'task a echo a\nreads a ../etc/passwd\n').err, 'error: line 2: invalid path ../etc/passwd\n')
})

test('order names the cycle it found and exits 3', () => {
  const input = 'task a echo a\ntask b echo b\nneeds a b\nneeds b a\n'
  assert.deepEqual(run(['order'], input), { code: 3, out: '', err: 'error: cycle: a -> b -> a\n' })
})

test('a task that needs itself is a cycle of one edge', () => {
  assert.equal(run(['order'], 'task a echo a\nneeds a a\n').err, 'error: cycle: a -> a\n')
})

test('the reported cycle is the first a depth-first search finds', () => {
  const input = 'task a echo a\ntask b echo b\ntask c echo c\nneeds b a\nneeds a c\nneeds c a\n'
  assert.equal(run(['order'], input).err, 'error: cycle: a -> c -> a\n')
})

test('plan skips every task when the snapshot matches the workspace', () => {
  assert.deepEqual(run(['plan', 'data/snapshots/current.snap'], GRAPH), {
    code: 0,
    out: 'skip build\nskip bundle\ntotal run=0 skip=2\n',
    err: '',
  })
})

test('a changed input runs its task and everything downstream', () => {
  assert.equal(
    run(['plan', 'data/snapshots/stale-a.snap'], GRAPH).out,
    'run build changed data/files/a.txt\nrun bundle needs build\ntotal run=2 skip=0\n',
  )
})

test('a path the snapshot never recorded is new, and a path reason beats a dependency one', () => {
  assert.equal(
    run(['plan', 'data/snapshots/partial.snap'], GRAPH).out,
    'run build new data/files/b.txt\nrun bundle new data/files/out-b.txt\ntotal run=2 skip=0\n',
  )
})

test('a recorded path that is gone from the workspace is missing', () => {
  const input = 'task a echo a\nreads a data/files/gone.txt\n'
  assert.equal(run(['plan', 'data/snapshots/gone.snap'], input).out, 'run a missing data/files/gone.txt\ntotal run=1 skip=0\n')
})

test('an output the task itself writes is watched like an input', () => {
  const input = 'task a echo a\nwrites a data/files/out-a.txt\n'
  assert.equal(run(['plan', 'data/snapshots/stale-out.snap'], input).out, 'run a changed data/files/out-a.txt\ntotal run=1 skip=0\n')
})

test('plan refuses a snapshot file that is not there', () => {
  assert.deepEqual(run(['plan', 'data/snapshots/nope.snap'], GRAPH), {
    code: 2,
    out: '',
    err: 'error: cannot read snapshot data/snapshots/nope.snap\n',
  })
})

test('a snapshot line that is not a path and a digest names its line', () => {
  assert.equal(
    run(['plan', 'data/snapshots/bad-line.snap'], GRAPH).err,
    'error: data/snapshots/bad-line.snap: line 2: expected <path> <digest>\n',
  )
})

test('a snapshot digest outside eight lowercase hex digits names its line', () => {
  assert.equal(
    run(['plan', 'data/snapshots/bad-digest.snap'], GRAPH).err,
    'error: data/snapshots/bad-digest.snap: line 2: invalid digest 784F5257\n',
  )
})

test('a path recorded twice in one snapshot names its second line', () => {
  assert.equal(
    run(['plan', 'data/snapshots/twice.snap'], GRAPH).err,
    'error: data/snapshots/twice.snap: line 3: path data/files/a.txt is recorded twice\n',
  )
})

test('plan reports a cycle the way order does', () => {
  const input = 'task a echo a\ntask b echo b\nneeds a b\nneeds b a\n'
  assert.deepEqual(run(['plan', 'data/snapshots/current.snap'], input), { code: 3, out: '', err: 'error: cycle: a -> b -> a\n' })
})

test('the usage line names every form', () => {
  assert.deepEqual(run(['sweep'], GRAPH), {
    code: 2,
    out: '',
    err: 'error: usage: cli.js order|show <name>|files <name>|digest <path>...|plan <snapshot>\n',
  })
})
