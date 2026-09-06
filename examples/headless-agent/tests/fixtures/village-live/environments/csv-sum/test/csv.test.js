import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sumColumn } from '../src/csv.js'

const orders = 'id,customer,amount\n1,ada,10.50\n2,linus,4\n3,grace,0.25\n'

test('sums a numeric column by header name', () => {
  assert.equal(sumColumn(orders, 'amount'), 14.75)
  assert.equal(sumColumn(orders, 'id'), 6)
})

test('ignores empty cells and tolerates a missing trailing newline', () => {
  assert.equal(sumColumn('n\n1\n\n2', 'n'), 3)
  assert.equal(sumColumn('a,b\n1,\n,2\n', 'b'), 2)
})

test('a document with only a header sums to zero', () => {
  assert.equal(sumColumn('amount\n', 'amount'), 0)
})

test('rejects an unknown column with a RangeError', () => {
  assert.throws(() => sumColumn(orders, 'total'), RangeError)
})

test('rejects a non-numeric cell with a TypeError naming the row', () => {
  assert.throws(() => sumColumn('amount\n1\nlots\n', 'amount'), (error) => error instanceof TypeError && /row 2/.test(error.message))
})
