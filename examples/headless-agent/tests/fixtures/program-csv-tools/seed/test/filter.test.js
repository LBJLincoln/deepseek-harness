/**
 * The `filter` corners of SPEC.md, run by the `filter` department and again by
 * the integration over the merged head.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filter } from '../src/filter.js';

const PEOPLE = {
  header: ['name', 'age'],
  rows: [['alice', '30'], ['bob', '9'], ['carol', '100'], ['dave', '']],
};

test('keeps the header and the equal rows', () => {
  const kept = filter(PEOPLE, 'name', '=', 'bob');
  assert.deepEqual(kept.header, ['name', 'age']);
  assert.deepEqual(kept.rows, [['bob', '9']]);
});

test('!= keeps everything else', () => {
  assert.deepEqual(filter(PEOPLE, 'name', '!=', 'bob').rows.map(row => row[0]), ['alice', 'carol', 'dave']);
});

test('< and > compare numbers as numbers', () => {
  assert.deepEqual(filter(PEOPLE, 'age', '>', '9').rows.map(row => row[0]), ['alice', 'carol']);
});

test('an empty cell is not a number, so it orders as text', () => {
  // '' sorts before '30' by code unit, which keeps dave and drops nothing else.
  assert.deepEqual(filter(PEOPLE, 'age', '<', '30').rows.map(row => row[0]), ['bob', 'dave']);
});

test('< and > compare anything else as strings', () => {
  assert.deepEqual(filter(PEOPLE, 'name', '<', 'c').rows.map(row => row[0]), ['alice', 'bob']);
});

test('contains is a case-sensitive substring test', () => {
  assert.deepEqual(filter(PEOPLE, 'name', 'contains', 'ar').rows.map(row => row[0]), ['carol']);
  assert.deepEqual(filter(PEOPLE, 'name', 'contains', 'AR').rows, []);
});

test('an empty operand matches every row with contains', () => {
  assert.equal(filter(PEOPLE, 'name', 'contains', '').rows.length, 4);
});

test('a filter nothing matches keeps the header alone', () => {
  assert.deepEqual(filter(PEOPLE, 'name', '=', 'nobody'), { header: ['name', 'age'], rows: [] });
});

test('refuses an operator outside the five', () => {
  assert.throws(() => filter(PEOPLE, 'name', '~', 'bob'), { message: 'unknown operator: ~', code: 'usage' });
});

test('refuses a column outside the header', () => {
  assert.throws(() => filter(PEOPLE, 'height', '=', '1'), { message: 'unknown column: height', code: 'data' });
});
