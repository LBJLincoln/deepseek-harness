/** The suite for the change this task asks for: the policy file, retries, backoff, and dead letters. */

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

test('a failed attempt waits out a doubling backoff before the next one', () => {
  assert.deepEqual(run(['trace', 'data/steady.policy'], 'job a 2 fail fail ok\nsubmit 0 a\n'), {
    code: 0,
    out: '0 a attempt=1 fail finish=2\n7 a attempt=2 fail finish=9\n19 a attempt=3 ok finish=21\nend 21\n',
    err: '',
  })
})

test('a backoff of zero puts the attempt back at the instant it failed', () => {
  assert.equal(
    run(['trace', 'data/retry-only.policy'], 'job a 1 fail fail ok\nsubmit 0 a\n').out,
    '0 a attempt=1 fail finish=1\n1 a attempt=2 fail finish=2\n2 a attempt=3 ok finish=3\nend 3\n',
  )
})

test('the last outcome a job declares repeats for every further attempt', () => {
  assert.equal(run(['dead', 'data/retry-only.policy'], 'job a 1 fail\nsubmit 0 a\n').out, 'a attempts=4 at=4\ntotal 1\n')
})

test('a job that runs its attempts out is dead-lettered', () => {
  assert.deepEqual(run(['summary', 'data/retry-only.policy'], 'job a 1 fail\nsubmit 0 a\n'), {
    code: 0,
    out: 'a attempts=4 dead\nend 4\n',
    err: '',
  })
})

test('a log with no retry policy keeps one attempt and writes nothing off', () => {
  assert.deepEqual(run(['dead'], 'job a 1 fail\nsubmit 0 a\n'), { code: 0, out: 'total 0\n', err: '' })
  assert.equal(run(['summary'], 'job a 1 fail\nsubmit 0 a\n').out, 'a attempts=1 fail\nend 1\n')
})

test('a retry start waits for the rate limit like any other', () => {
  const log = 'job a 1 fail ok\njob b 1 ok\nsubmit 0 a\nsubmit 0 b\n'
  assert.equal(
    run(['trace', 'data/steady.policy'], log).out,
    '0 a attempt=1 fail finish=1\n1 b attempt=1 ok finish=2\n10 a attempt=2 ok finish=11\nend 11\n',
  )
})

test('the log may declare the retry policy itself', () => {
  assert.equal(
    run(['trace'], 'retry 2 4\njob a 1 fail\nsubmit 0 a\n').out,
    '0 a attempt=1 fail finish=1\n5 a attempt=2 fail finish=6\nend 6\n',
  )
})

test('a policy file and a log line for the same directive collide at the log line', () => {
  assert.deepEqual(run(['trace', 'data/steady.policy'], 'retry 2 4\njob a 1 fail\nsubmit 0 a\n'), {
    code: 2,
    out: '',
    err: 'error: line 1: retry is declared twice\n',
  })
})

test('the policy file takes only limit and retry lines', () => {
  assert.equal(run(['trace', 'data/bad.policy'], '').err, 'error: data/bad.policy: line 2: unknown directive job\n')
})

test('a policy file that declares one directive twice names its second line', () => {
  assert.equal(run(['trace', 'data/twice.policy'], '').err, 'error: data/twice.policy: line 2: retry is declared twice\n')
})

test('a policy file that is not there is refused by name', () => {
  assert.deepEqual(run(['trace', 'data/nope.policy'], ''), { code: 2, out: '', err: 'error: cannot read policy data/nope.policy\n' })
})

test('the policy file is read before the log', () => {
  assert.equal(run(['trace', 'data/nope.policy'], 'cancel a\n').err, 'error: cannot read policy data/nope.policy\n')
})

test('an empty policy file leaves the run unconstrained', () => {
  assert.equal(run(['trace', 'data/empty.policy'], 'job a 1 fail\nsubmit 0 a\n').out, '0 a attempt=1 fail finish=1\nend 1\n')
})

test('dead letters are listed in the order they were written off', () => {
  const log = 'job a 5 fail\njob b 1 fail\nsubmit 0 a\nsubmit 0 b\n'
  assert.equal(run(['dead', 'data/retry-only.policy'], log).out, 'a attempts=4 at=23\nb attempts=4 at=24\ntotal 2\n')
})

test('the usage line names the optional policy argument', () => {
  assert.deepEqual(run(['walk'], ''), { code: 2, out: '', err: 'error: usage: cli.js trace|summary|dead [<policy>]\n' })
})
