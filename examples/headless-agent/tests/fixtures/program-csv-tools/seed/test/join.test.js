/**
 * The `join` corners of SPEC.md, run by the `join` department and again by the
 * integration over the merged head.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from '../src/join.js';

const ORDERS = { header: ['id', 'total'], rows: [['1', '10'], ['2', '20'], ['3', '30']] };
const CUSTOMERS = { header: ['id', 'name'], rows: [['2', 'bob'], ['1', 'alice']] };

test('carries the left columns and the right ones except the join column', () => {
  assert.deepEqual(join(ORDERS, CUSTOMERS, 'id').header, ['id', 'total', 'name']);
});

test('keeps only the rows both sides carry, left order outermost', () => {
  assert.deepEqual(join(ORDERS, CUSTOMERS, 'id').rows, [['1', '10', 'alice'], ['2', '20', 'bob']]);
});

test('a key repeated on both sides yields every pair', () => {
  const left = { header: ['k', 'l'], rows: [['x', 'l1'], ['x', 'l2']] };
  const right = { header: ['k', 'r'], rows: [['x', 'r1'], ['x', 'r2']] };
  assert.deepEqual(join(left, right, 'k').rows, [
    ['x', 'l1', 'r1'],
    ['x', 'l1', 'r2'],
    ['x', 'l2', 'r1'],
    ['x', 'l2', 'r2'],
  ]);
});

test('joins on the cells as strings', () => {
  const left = { header: ['k'], rows: [['01']] };
  const right = { header: ['k', 'r'], rows: [['1', 'no'], ['01', 'yes']] };
  assert.deepEqual(join(left, right, 'k').rows, [['01', 'yes']]);
});

test('no shared key leaves the header alone', () => {
  assert.deepEqual(join(ORDERS, { header: ['id'], rows: [['9']] }, 'id'), { header: ['id', 'total'], rows: [] });
});

test('refuses a column missing from either header', () => {
  assert.throws(() => join(ORDERS, CUSTOMERS, 'name'), { message: 'unknown column: name', code: 'data' });
  assert.throws(() => join(ORDERS, CUSTOMERS, 'total'), { message: 'unknown column: total', code: 'data' });
});

test('refuses a carried right column the left header already has', () => {
  const right = { header: ['id', 'total'], rows: [['1', 'x']] };
  assert.throws(() => join(ORDERS, right, 'id'), { message: 'duplicate column: total', code: 'data' });
});
