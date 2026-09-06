import assert from 'node:assert/strict'
import { test } from 'node:test'
import { paginate } from '../src/paginate.js'

const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

test('pages are 1-based', () => {
  assert.deepEqual(paginate(ten, 1, 3), { page: 1, pages: 4, items: [1, 2, 3] })
  assert.deepEqual(paginate(ten, 2, 3), { page: 2, pages: 4, items: [4, 5, 6] })
})

test('the last page holds the remainder and later pages are empty', () => {
  assert.deepEqual(paginate(ten, 4, 3), { page: 4, pages: 4, items: [10] })
  assert.deepEqual(paginate(ten, 5, 3), { page: 5, pages: 4, items: [] })
})

test('an exact multiple has no extra page and an empty list has none', () => {
  assert.equal(paginate(ten, 1, 5).pages, 2)
  assert.deepEqual(paginate([], 1, 5), { page: 1, pages: 0, items: [] })
})

test('rejects a non-positive or fractional size or page', () => {
  assert.throws(() => paginate(ten, 1, 0), RangeError)
  assert.throws(() => paginate(ten, 0, 3), RangeError)
  assert.throws(() => paginate(ten, 1.5, 3), RangeError)
})

test('does not mutate the input', () => {
  const copy = [...ten]
  paginate(copy, 2, 3)
  assert.deepEqual(copy, ten)
})
