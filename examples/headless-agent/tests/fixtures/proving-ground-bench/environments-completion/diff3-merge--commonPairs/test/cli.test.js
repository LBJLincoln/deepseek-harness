import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url))

function run(argv, mine, base, theirs) {
  const input = [mine, base, theirs].map(part => part.map(line => `${line}\n`).join('')).join('%%%\n')
  const result = spawnSync(process.execPath, [cli, ...argv], { encoding: 'utf8', input })
  return { code: result.status, out: result.stdout, err: result.stderr }
}

test('three identical documents merge to themselves', () => {
  assert.deepEqual(run(['merge'], ['a', 'b'], ['a', 'b'], ['a', 'b']), { code: 0, out: 'a\nb\n', err: '' })
})

test('a change only one side made is taken', () => {
  assert.deepEqual(run(['merge'], ['a', 'X'], ['a', 'b'], ['a', 'b']), { code: 0, out: 'a\nX\n', err: '' })
})

test('a change only the other side made is taken', () => {
  assert.equal(run(['merge'], ['a', 'b'], ['a', 'b'], ['a', 'Z']).out, 'a\nZ\n')
})

test('changes in different places both survive', () => {
  assert.equal(run(['merge'], ['X', 'b', 'c'], ['a', 'b', 'c'], ['a', 'b', 'Z']).out, 'X\nb\nZ\n')
})

test('the same change on both sides is not a conflict', () => {
  assert.deepEqual(run(['merge'], ['a', 'X'], ['a', 'b'], ['a', 'X']), { code: 0, out: 'a\nX\n', err: '' })
})

test('a line only one side inserted is kept', () => {
  assert.equal(run(['merge'], ['a', 'Q', 'b'], ['a', 'b'], ['a', 'b']).out, 'a\nQ\nb\n')
})

test('a line only one side deleted stays deleted', () => {
  assert.equal(run(['merge'], ['a', 'c'], ['a', 'b', 'c'], ['a', 'b', 'c']).out, 'a\nc\n')
})

test('two different changes to one line conflict and exit 1', () => {
  const result = run(['merge'], ['a', 'X', 'c'], ['a', 'b', 'c'], ['a', 'Y', 'c'])
  assert.equal(result.code, 1)
  assert.equal(result.out, 'a\n<<<<<<< mine\nX\n||||||| base\nb\n=======\nY\n>>>>>>> theirs\nc\n')
  assert.equal(result.err, '')
})

test('merge2 leaves the base section out of a conflict', () => {
  assert.equal(
    run(['merge2'], ['a', 'X', 'c'], ['a', 'b', 'c'], ['a', 'Y', 'c']).out,
    'a\n<<<<<<< mine\nX\n=======\nY\n>>>>>>> theirs\nc\n',
  )
})

test('regions classify a clean merge', () => {
  assert.deepEqual(run(['regions'], ['a', 'X'], ['a', 'b'], ['a', 'b']), { code: 0, out: 'stable 1\nmine 1\n', err: '' })
})

test('regions name the side that changed', () => {
  assert.equal(run(['regions'], ['a', 'b'], ['a', 'b'], ['a', 'Z']).out, 'stable 1\ntheirs 1\n')
})

test('regions report the size of a conflict', () => {
  const result = run(['regions'], ['a', 'X', 'c'], ['a', 'b', 'c'], ['a', 'Y', 'c'])
  assert.equal(result.code, 1)
  assert.equal(result.out, 'stable 1\nconflict mine=1 base=1 theirs=1\nstable 1\n')
})

test('three empty documents merge to nothing', () => {
  assert.deepEqual(run(['merge'], [], [], []), { code: 0, out: '', err: '' })
})

test('input with the wrong number of parts is rejected', () => {
  const result = spawnSync(process.execPath, [cli, 'merge'], { encoding: 'utf8', input: 'a\n%%%\nb\n' })
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, 'error: expected three parts separated by %%%\n')
})

test('an unknown mode is rejected', () => {
  const result = spawnSync(process.execPath, [cli, 'diff'], { encoding: 'utf8', input: '' })
  assert.equal(result.status, 2)
  assert.equal(result.stderr, 'error: usage: cli.js merge|merge2|regions\n')
})
