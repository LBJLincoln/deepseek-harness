import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url))

const DIAMOND = 'task a 3\ntask b 2\ntask c 4\ntask d 1\ndep b a\ndep c a\ndep d b c\n'

function run(argv, stdin = '') {
  const result = spawnSync(process.execPath, [cli, ...argv], { encoding: 'utf8', input: stdin })
  return { code: result.status, out: result.stdout, err: result.stderr }
}

test('waves group the tasks by dependency depth', () => {
  assert.deepEqual(run(['waves'], DIAMOND), { code: 0, out: 'wave 0: a\nwave 1: b c\nwave 2: d\ntotal 8\n', err: '' })
})

test('a chain is one task per wave', () => {
  assert.equal(run(['waves'], 'task x 1\ntask y 2\ndep y x\n').out, 'wave 0: x\nwave 1: y\ntotal 3\n')
})

test('explain reports the start, finish and depth of every task in name order', () => {
  assert.equal(
    run(['explain'], DIAMOND).out,
    'a start=0 finish=3 depth=0\nb start=3 finish=5 depth=1\nc start=3 finish=7 depth=1\nd start=7 finish=8 depth=2\ntotal 8\n',
  )
})

test('pack onto one worker runs everything in sequence', () => {
  assert.equal(run(['pack', '1'], 'task x 1\ntask y 2\ndep y x\n').out, 'worker 0: x@0-1 y@1-3\nmakespan 3\n')
})

test('pack onto two workers reaches the unlimited makespan of the diamond', () => {
  assert.equal(run(['pack', '2'], DIAMOND).out, 'worker 0: a@0-3 c@3-7 d@7-8\nworker 1: b@3-5\nmakespan 8\n')
})

test('a worker with nothing to run still prints its line', () => {
  assert.equal(run(['pack', '2'], 'task solo 4\n').out, 'worker 0: solo@0-4\nworker 1:\nmakespan 4\n')
})

test('blank lines and comments are ignored', () => {
  assert.equal(run(['waves'], '# note\n\ntask a 2\n').out, 'wave 0: a\ntotal 2\n')
})

test('an empty graph has no wave and a total of zero', () => {
  assert.deepEqual(run(['waves'], ''), { code: 0, out: 'total 0\n', err: '' })
})

test('a cycle is reported on standard error and exits 3', () => {
  const result = run(['waves'], 'task a 1\ntask b 1\ndep a b\ndep b a\n')
  assert.equal(result.code, 3)
  assert.equal(result.out, '')
  assert.equal(result.err, 'error: cycle: a -> b -> a\n')
})

test('a dependency on a task that was never declared is rejected', () => {
  const result = run(['waves'], 'task a 1\ndep a ghost\n')
  assert.equal(result.code, 2)
  assert.equal(result.err, 'error: unknown task ghost\n')
})

test('a task declared twice is rejected with its line', () => {
  const result = run(['waves'], 'task a 1\ntask a 2\n')
  assert.equal(result.code, 2)
  assert.equal(result.err, 'error: line 2: task a is declared twice\n')
})

test('an unknown directive is rejected with its line', () => {
  assert.equal(run(['waves'], 'task a 1\nbuild a\n').err, 'error: line 2: unknown directive build\n')
})

test('a negative cost is rejected', () => {
  assert.equal(run(['waves'], 'task a -1\n').err, 'error: line 1: cost must be a non-negative integer\n')
})

test('an unknown mode is rejected', () => {
  const result = run(['sprint'], '')
  assert.equal(result.code, 2)
  assert.equal(result.out, '')
  assert.equal(result.err, 'error: usage: cli.js waves|explain|pack <workers>\n')
})

test('pack without a worker count is rejected', () => {
  assert.equal(run(['pack'], DIAMOND).code, 2)
})
