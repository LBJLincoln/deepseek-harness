/**
 * The `stats` corners of SPEC.md, run by the `stats` department and again by
 * the integration over the merged head.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stats } from '../src/stats.js';

/**
 * @param {string[]} header column names
 * @param {string[][]} rows data rows
 * @returns {{ header: string[], rows: string[][] }} the table those two make
 */
function table(header, rows) {
  return { header, rows };
}

test('always writes its own header', () => {
  assert.deepEqual(stats(table(['name'], [['alice']])), {
    header: ['column', 'count', 'min', 'max', 'mean'],
    rows: [],
  });
});

test('summarises every numeric column in header order', () => {
  const summary = stats(table(['b', 'a'], [['2', '10'], ['4', '20'], ['6', '30']]));
  assert.deepEqual(summary.rows, [['b', '3', '2', '6', '4'], ['a', '3', '10', '30', '20']]);
});

test('skips empty values instead of counting them', () => {
  assert.deepEqual(stats(table(['n'], [['1'], [''], ['3']])).rows, [['n', '2', '1', '3', '2']]);
});

test('a column of only empty values is not numeric', () => {
  assert.deepEqual(stats(table(['n'], [[''], ['']])).rows, []);
});

test('one non-numeric value makes the whole column text', () => {
  assert.deepEqual(stats(table(['n'], [['1'], ['x'], ['3']])).rows, []);
});

test('zero-padded identifiers are text', () => {
  assert.deepEqual(stats(table(['id'], [['007'], ['008']])).rows, []);
});

test('reads signs, decimals and exponents', () => {
  assert.deepEqual(stats(table(['n'], [['-1.5'], ['2e3']])).rows, [['n', '2', '-1.5', '2000', '999.25']]);
});

test('rounds a result to six decimal places', () => {
  assert.deepEqual(stats(table(['n'], [['1'], ['1'], ['2']])).rows, [['n', '3', '1', '2', '1.333333']]);
});
