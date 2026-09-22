import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url))
const RACE = 'candidates alice bob carol\nballot 4 alice bob\nballot 3 bob carol\nballot 2 carol bob\nballot 1 carol\n'

function run(argv, stdin = '') {
  const result = spawnSync(process.execPath, [cli, ...argv], { encoding: 'utf8', input: stdin })
  return { code: result.status, out: result.stdout, err: result.stderr }
}

test('a first-round majority wins at once', () => {
  const input = 'candidates a b\nballot 3 a\nballot 1 b\n'
  assert.deepEqual(run(['rounds'], input), { code: 0, out: 'round 1: a=3 b=1 exhausted=0\nwinner a\n', err: '' })
})

test('the runoff transfers votes from the eliminated candidate', () => {
  assert.equal(run(['rounds'], RACE).out, 'round 1: alice=4 bob=3 carol=3 exhausted=0\neliminated carol\nround 2: bob=5 alice=4 exhausted=1\nwinner bob\n')
})

test('tally prints only the round count and the outcome', () => {
  assert.deepEqual(run(['tally'], RACE), { code: 0, out: 'rounds 2\nwinner bob\n', err: '' })
})

test('a ballot whose choices are all eliminated becomes exhausted', () => {
  assert.equal(run(['rounds'], 'candidates a b c\nballot 3 a\nballot 2 b\nballot 1 c\n').out, 'round 1: a=3 b=2 c=1 exhausted=0\neliminated c\nround 2: a=3 b=2 exhausted=1\nwinner a\n')
})

test('counts are listed by descending votes and then by name', () => {
  assert.equal(run(['rounds'], 'candidates zeta alpha\nballot 1 zeta\nballot 1 alpha\n').out.split('\n')[0], 'round 1: alpha=1 zeta=1 exhausted=0')
})

test('a candidate nobody ranked still appears with zero', () => {
  assert.equal(run(['rounds'], 'candidates a b c\nballot 1 a\n').out, 'round 1: a=1 b=0 c=0 exhausted=0\nwinner a\n')
})

test('an election with no ballot has no winner', () => {
  assert.deepEqual(run(['rounds'], 'candidates a b\n'), { code: 0, out: 'round 1: a=0 b=0 exhausted=0\nno winner\n', err: '' })
})

test('blank lines and comments are ignored', () => {
  assert.equal(run(['tally'], '# vote\n\ncandidates a\nballot 1 a\n').out, 'rounds 1\nwinner a\n')
})

test('a ballot before the candidates is rejected', () => {
  const result = run(['tally'], 'ballot 1 a\ncandidates a\n')
  assert.equal(result.code, 2)
  assert.equal(result.out, '')
  assert.equal(result.err, 'error: line 1: candidates must be declared once, before any ballot\n')
})

test('a second candidates line is rejected', () => {
  assert.equal(run(['tally'], 'candidates a\ncandidates b\n').err, 'error: line 2: candidates must be declared once, before any ballot\n')
})

test('a ballot naming an undeclared candidate is rejected', () => {
  assert.equal(run(['tally'], 'candidates a\nballot 1 z\n').err, 'error: line 2: unknown candidate z\n')
})

test('a ballot that repeats a candidate is rejected', () => {
  assert.equal(run(['tally'], 'candidates a b\nballot 1 a b a\n').err, 'error: line 2: candidate a is repeated\n')
})

test('a non-positive ballot count is rejected', () => {
  assert.equal(run(['tally'], 'candidates a\nballot 0 a\n').err, 'error: line 2: count must be a positive integer\n')
})

test('an input with no candidates line is rejected', () => {
  assert.equal(run(['tally'], '# nothing\n').err, 'error: no candidates\n')
})

test('an unknown directive is rejected', () => {
  assert.equal(run(['tally'], 'candidates a\nvote 1 a\n').err, 'error: line 2: unknown directive vote\n')
})

test('an unknown mode is rejected', () => {
  const result = run(['count'], RACE)
  assert.equal(result.code, 2)
  assert.equal(result.err, 'error: usage: cli.js rounds|tally\n')
})
