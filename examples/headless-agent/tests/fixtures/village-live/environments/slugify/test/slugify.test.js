import assert from 'node:assert/strict'
import { test } from 'node:test'
import { slugify } from '../src/slugify.js'

test('lowercases and joins words with single hyphens', () => {
  assert.equal(slugify('Hello World'), 'hello-world')
  assert.equal(slugify('  Leading and trailing  '), 'leading-and-trailing')
})

test('strips diacritics', () => {
  assert.equal(slugify('Crème Brûlée'), 'creme-brulee')
  assert.equal(slugify('Ünïcödé Tëst 123'), 'unicode-test-123')
})

test('collapses runs of separators and trims hyphens', () => {
  assert.equal(slugify('a--b___c...d'), 'a-b-c-d')
  assert.equal(slugify('!!!hello!!!'), 'hello')
})

test('returns an empty slug for empty or separator-only input', () => {
  assert.equal(slugify(''), '')
  assert.equal(slugify('   ---   '), '')
})

test('rejects non-string input with a TypeError', () => {
  assert.throws(() => slugify(42), TypeError)
  assert.throws(() => slugify(null), TypeError)
})
