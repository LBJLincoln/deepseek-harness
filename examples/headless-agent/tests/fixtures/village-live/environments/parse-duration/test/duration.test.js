import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseDuration } from '../src/duration.js'

test('sums hours, minutes, and seconds', () => {
  assert.equal(parseDuration('1h30m15s'), 5415)
  assert.equal(parseDuration('2h'), 7200)
  assert.equal(parseDuration('45m'), 2700)
  assert.equal(parseDuration('90s'), 90)
  assert.equal(parseDuration('1h1s'), 3601)
  assert.equal(parseDuration('0s'), 0)
})

test('accepts each unit at most once, in hours, minutes, seconds order', () => {
  assert.throws(() => parseDuration('1h1h'), TypeError)
  assert.throws(() => parseDuration('30m1h'), TypeError)
  assert.throws(() => parseDuration('5s1m'), TypeError)
})

test('rejects malformed input', () => {
  assert.throws(() => parseDuration(''), TypeError)
  assert.throws(() => parseDuration('1x'), TypeError)
  assert.throws(() => parseDuration('h1'), TypeError)
  assert.throws(() => parseDuration('1.5h'), TypeError)
  assert.throws(() => parseDuration(' 1h'), TypeError)
  assert.throws(() => parseDuration('1h '), TypeError)
  assert.throws(() => parseDuration('-1h'), TypeError)
  assert.throws(() => parseDuration(15), TypeError)
})
