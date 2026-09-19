/** The repository's own suite, covering what `jobq` already does. */

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

const TWO = 'job a 5 ok\njob b 3 fail\nsubmit 0 a\nsubmit 0 b\n'

test('one worker runs the submissions in ready order', () => {
  assert.deepEqual(run(['trace'], TWO), {
    code: 0,
    out: '0 a attempt=1 ok finish=5\n5 b attempt=1 fail finish=8\nend 8\n',
    err: '',
  })
})

test('a job submitted later waits for the clock to reach it', () => {
  const log = 'job a 1 ok\njob b 1 ok\nsubmit 40 a\nsubmit 0 b\n'
  assert.equal(run(['trace'], log).out, '0 b attempt=1 ok finish=1\n40 a attempt=1 ok finish=41\nend 41\n')
})

test('two jobs ready at once are taken in submission order', () => {
  const log = 'job z 1 ok\njob a 1 ok\nsubmit 0 z\nsubmit 0 a\n'
  assert.equal(run(['trace'], log).out, '0 z attempt=1 ok finish=1\n1 a attempt=1 ok finish=2\nend 2\n')
})

test('the rate limit holds a start back until the window has room', () => {
  const log = 'limit 2 10\njob a 1 ok\njob b 1 ok\njob c 1 ok\nsubmit 0 a\nsubmit 0 b\nsubmit 0 c\n'
  assert.equal(
    run(['trace'], log).out,
    '0 a attempt=1 ok finish=1\n1 b attempt=1 ok finish=2\n10 c attempt=1 ok finish=11\nend 11\n',
  )
})

test('a job of zero duration finishes in the instant it starts', () => {
  assert.equal(run(['trace'], 'job a 0 ok\nsubmit 7 a\n').out, '7 a attempt=1 ok finish=7\nend 7\n')
})

test('summary lists the submitted jobs in ascending id order', () => {
  assert.deepEqual(run(['summary'], TWO), { code: 0, out: 'a attempts=1 ok\nb attempts=1 fail\nend 8\n', err: '' })
})

test('a declared job nothing submits never runs', () => {
  assert.equal(run(['summary'], 'job a 1 ok\njob b 1 ok\nsubmit 0 b\n').out, 'b attempts=1 ok\nend 1\n')
})

test('an empty log runs nothing and ends at zero', () => {
  assert.deepEqual(run(['trace'], ''), { code: 0, out: 'end 0\n', err: '' })
})

test('comments and blank lines are ignored', () => {
  assert.equal(run(['trace'], '# queue\n\njob a 1 ok\nsubmit 0 a\n').out, '0 a attempt=1 ok finish=1\nend 1\n')
})

test('a job line without an outcome is refused', () => {
  assert.deepEqual(run(['trace'], 'job a 1\n'), { code: 2, out: '', err: 'error: line 1: expected job <id> <duration> <outcome>...\n' })
})

test('an outcome word outside ok and fail names its line', () => {
  assert.equal(run(['trace'], 'job a 1 maybe\n').err, 'error: line 1: invalid outcome maybe\n')
})

test('a duration that is not a number names the field', () => {
  assert.equal(run(['trace'], 'job a x ok\n').err, 'error: line 1: duration must be a non-negative integer\n')
})

test('a limit of zero starts names the field', () => {
  assert.equal(run(['trace'], 'limit 0 10\n').err, 'error: line 1: starts must be a positive integer\n')
})

test('a second limit line names its own line', () => {
  assert.equal(run(['trace'], 'limit 1 1\nlimit 2 2\n').err, 'error: line 2: limit is declared twice\n')
})

test('a job declared twice names its second line', () => {
  assert.equal(run(['trace'], 'job a 1 ok\njob a 2 ok\n').err, 'error: line 2: job a is declared twice\n')
})

test('a job submitted twice names its second line', () => {
  assert.equal(run(['trace'], 'job a 1 ok\nsubmit 0 a\nsubmit 1 a\n').err, 'error: line 3: job a is submitted twice\n')
})

test('an unknown directive names its line', () => {
  assert.equal(run(['trace'], 'cancel a\n').err, 'error: line 1: unknown directive cancel\n')
})

test('a submission of an undeclared job is refused without a line number', () => {
  assert.equal(run(['trace'], 'job a 1 ok\nsubmit 0 ghost\n').err, 'error: unknown job ghost\n')
})

test('a malformed argument list is refused with the usage line', () => {
  const failed = run(['walk'], TWO)
  assert.equal(failed.code, 2)
  assert.equal(failed.out, '')
  assert.match(failed.err, /^error: usage: cli\.js /u)
})
