// Behaviour of readme-rows.mjs on records built here: the per-language cell
// forms, the row order, the `{model}` placeholder, and the refusals. The
// committed rows of data/proving-ground/README.md are the rows the tool must
// reproduce byte for byte; those comparisons run as shell checks beside this
// suite, so this file covers the forms a record on disk may not exercise.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { joinChinese, joinEnglish, parseArgs, readRecord, rowsOf } from './readme-rows.mjs'

const HEAD = 'c78acc5fc28214cf887daf7e8981f6af77a0ccb9'

/** One cell of a synthetic record. */
function cell(environment, { model = 'haiku', repetition = 0, group = 'fleet-0', certified = true, attempts = 1, seconds = 10 } = {}) {
  return { environment, model, repetition, arm: group.startsWith('experiment-') ? group.slice(group.lastIndexOf('-') + 1) : 'fleet', certified, attempts, seconds }
}

function fleet(cells) {
  return { run: 'run-a', head: HEAD, kind: 'fleet', cells }
}

function pair(cells) {
  return { run: 'run-b', head: HEAD, kind: 'pair', cells }
}

const arm = arm => `experiment-0-${arm}`

test('lists read a and b, a, b, and c in English and a 与 b, a、b 与 c in Chinese', () => {
  assert.equal(joinEnglish([7]), '7')
  assert.equal(joinEnglish([7, 8]), '7 and 8')
  assert.equal(joinEnglish([7, 8, 9]), '7, 8, and 9')
  assert.equal(joinChinese([7]), '7')
  assert.equal(joinChinese([7, 8]), '7 与 8')
  assert.equal(joinChinese([7, 8, 9]), '7、8 与 9')
})

test('a fleet of one repetition prints one row per environment and model, sorted by environment then model', () => {
  const record = fleet([
    cell('code:b', { model: 'sonnet', seconds: 52 }),
    cell('code:b', { model: 'haiku', seconds: 101 }),
    cell('code:a', { model: 'haiku', certified: false, attempts: 3, seconds: 462 }),
  ])
  assert.deepEqual(rowsOf(record, { lang: 'en', implementer: '`route` on `{model}`, sealed' }), [
    '| [run-a](run-a/manifest.json) | `c78acc5fc` | `route` on `haiku`, sealed | `code:a` | 0 of 1 | 3 | 462 s |',
    '| [run-a](run-a/manifest.json) | `c78acc5fc` | `route` on `haiku`, sealed | `code:b` | 1 of 1 | 1 | 101 s |',
    '| [run-a](run-a/manifest.json) | `c78acc5fc` | `route` on `sonnet`, sealed | `code:b` | 1 of 1 | 1 | 52 s |',
  ])
  assert.deepEqual(rowsOf(record, { lang: 'zh', implementer: '`route`，走 `{model}`，密封' }).map(row => row.split(' | ').slice(4).join(' | ')), [
    '0 之 1 | 3 | 462 s |',
    '1 之 1 | 1 | 101 s |',
    '1 之 1 | 1 | 52 s |',
  ])
})

test('a fleet of several repetitions folds them in repetition order: N each when the attempts agree, the list otherwise', () => {
  const record = fleet([
    cell('code:a', { repetition: 1, seconds: 166 }),
    cell('code:a', { repetition: 0, seconds: 162 }),
    cell('code:b', { repetition: 0, attempts: 1, seconds: 91, certified: false }),
    cell('code:b', { repetition: 1, attempts: 2, seconds: 100 }),
    cell('code:b', { repetition: 2, attempts: 1, seconds: 87 }),
  ])
  const tail = row => row.split(' | ').slice(4).join(' | ')
  assert.deepEqual(rowsOf(record, { lang: 'en', implementer: 'x' }).map(tail), [
    '2 of 2 | 1 each | 162 and 166 s |',
    '2 of 3 | 1, 2, and 1 | 91, 100, and 87 s |',
  ])
  assert.deepEqual(rowsOf(record, { lang: 'zh', implementer: 'x' }).map(tail), [
    '2 之 2 | 各 1 | 162 与 166 s |',
    '2 之 3 | 1、2 与 1 | 91、100 与 87 s |',
  ])
})

test('a frozen pair prints one row per environment, baseline then candidate, with the pair seconds form', () => {
  const record = pair([
    cell('code:a', { group: arm('candidate'), repetition: 1, seconds: 429 }),
    cell('code:a', { group: arm('baseline'), repetition: 0, seconds: 265 }),
    cell('code:a', { group: arm('candidate'), repetition: 0, seconds: 372 }),
    cell('code:a', { group: arm('baseline'), repetition: 1, seconds: 202, certified: false, attempts: 2 }),
  ])
  assert.deepEqual(rowsOf(record, { lang: 'en', implementer: '`route`, `sonnet` vs `sonnet` `+review`' }), [
    '| [run-b](run-b/manifest.json) | `c78acc5fc` | `route`, `sonnet` vs `sonnet` `+review` | `code:a` | 1 of 2 vs 2 of 2 | 1 and 2 vs 1 each | 265 and 202 s vs 372 and 429 s |',
  ])
  assert.deepEqual(rowsOf(record, { lang: 'zh', implementer: 'x' }).map(row => row.split(' | ').slice(4).join(' | ')), [
    '1 之 2 对 2 之 2 | 1 与 2 对 各 1 | 265、202 s 对 372、429 s |',
  ])
})

test('the model placeholder is filled from the row and refused when the row has no one model', () => {
  const shared = pair([cell('code:a', { group: arm('baseline') }), cell('code:a', { group: arm('candidate') })])
  assert.match(rowsOf(shared, { lang: 'en', implementer: '{model} twice' })[0], / \| haiku twice \| /)
  const split = pair([cell('code:a', { group: arm('baseline'), model: 'haiku' }), cell('code:a', { group: arm('candidate'), model: 'sonnet' })])
  assert.throws(() => rowsOf(split, { lang: 'en', implementer: '{model}' }), /code:a: its cells ran haiku, sonnet/)
  assert.equal(rowsOf(split, { lang: 'en', implementer: 'both' })[0].split(' | ')[2], 'both')
})

test('a pair an arm never ran and an unknown language are refused', () => {
  const half = pair([cell('code:a', { group: arm('baseline') })])
  assert.throws(() => rowsOf(half, { lang: 'en', implementer: 'x' }), /code:a: no candidate cell/)
  assert.throws(() => rowsOf(half, { lang: 'fr', implementer: 'x' }), /--lang must be en or zh/)
})

test('a record is read from manifest.json, result.json and facts.jsonl, and a program record is refused', () => {
  const root = mkdtempSync(join(tmpdir(), 'readme-rows-'))
  try {
    const record = join(root, 'run-c')
    mkdirSync(record)
    writeFileSync(join(record, 'manifest.json'), JSON.stringify({ run: 'run-c', repository: { head: HEAD } }))
    writeFileSync(join(record, 'result.json'), JSON.stringify({ result: { arms: { baseline: {}, candidate: {} } } }))
    const fact = (group, repetition, wallMs, attempts, certified) => JSON.stringify({
      identity: { environment: { environmentId: 'code:a', model: 'sonnet', repetition, group } },
      outcome: { certified, attempts },
      efficiency: { wallMs },
    })
    writeFileSync(join(record, 'facts.jsonl'), [
      fact('experiment-ab-baseline', 0, 265_400, 1, true),
      fact('experiment-ab-candidate', 0, 371_600, 1, true),
      fact('experiment-ab-baseline', 1, 202_000, 1, false),
      fact('experiment-ab-candidate', 1, 429_000, 1, true),
    ].join('\n').concat('\n'))
    const read = readRecord(record)
    assert.equal(read.kind, 'pair')
    assert.deepEqual(read.cells.map(cell => [cell.arm, cell.repetition, cell.seconds, cell.certified]), [
      ['baseline', 0, 265, true],
      ['candidate', 0, 372, true],
      ['baseline', 1, 202, false],
      ['candidate', 1, 429, true],
    ])
    assert.equal(rowsOf(read, { lang: 'en', implementer: 'x' })[0].split(' | ').slice(4).join(' | '), '1 of 2 vs 2 of 2 | 1 each vs 1 each | 265 and 202 s vs 372 and 429 s |')

    const program = join(root, 'run-d')
    mkdirSync(program)
    writeFileSync(join(program, 'manifest.json'), JSON.stringify({ run: 'run-d', repository: { head: HEAD } }))
    writeFileSync(join(program, 'result.json'), JSON.stringify({ type: 'result', report: undefined, goals: [] }))
    writeFileSync(join(program, 'facts.jsonl'), '')
    assert.throws(() => readRecord(program), /neither a fleet report nor a frozen pair/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the command line needs the record, --lang en|zh and --implementer', () => {
  assert.deepEqual(parseArgs(['r', '--lang', 'zh', '--implementer', 'text']), { directory: 'r', lang: 'zh', implementer: 'text' })
  assert.throws(() => parseArgs(['r', '--lang', 'en']), /usage:/)
  assert.throws(() => parseArgs(['r', '--lang', 'fr', '--implementer', 'x']), /--lang must be en or zh/)
  assert.throws(() => parseArgs(['r', '--lang']), /--lang needs a value/)
  assert.throws(() => parseArgs(['r', '--lang', 'en', '--implementer', 'x', '--json']), /unknown option --json/)
  assert.throws(() => parseArgs(['r', 's', '--lang', 'en', '--implementer', 'x']), /usage:/)
})
