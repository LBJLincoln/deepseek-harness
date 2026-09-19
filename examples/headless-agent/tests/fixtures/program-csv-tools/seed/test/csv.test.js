/**
 * The reader and writer corners of SPEC.md, run by the `stats` department and
 * again by the integration over the merged head.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { escapeField, formatCsv, parseCsv } from '../src/csv.js';

test('reads a header and its rows', () => {
  assert.deepEqual(parseCsv('a,b\n1,2\n3,4\n'), { header: ['a', 'b'], rows: [['1', '2'], ['3', '4']] });
});

test('closes the last record with or without a trailing terminator', () => {
  assert.deepEqual(parseCsv('a\nx').rows, [['x']]);
  assert.deepEqual(parseCsv('a\nx\n').rows, [['x']]);
});

test('a second trailing terminator starts an empty record', () => {
  assert.deepEqual(parseCsv('a\nx\n\n').rows, [['x'], ['']]);
});

test('one terminator alone is one record of one empty field', () => {
  assert.deepEqual(parseCsv('\n'), { header: [''], rows: [] });
});

test('accepts CRLF, LF and a lone CR', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2\r3,4\n').rows, [['1', '2'], ['3', '4']]);
});

test('reads a quoted field with a doubled quote, a comma and a terminator', () => {
  assert.deepEqual(parseCsv('a\n"say ""hi"", now\nagain"\n').rows, [['say "hi", now\nagain']]);
});

test('a quote that is not the first character is ordinary text', () => {
  assert.deepEqual(parseCsv('a\nx"y\n').rows, [['x"y']]);
});

test('never trims, and keeps empty fields wherever they appear', () => {
  assert.deepEqual(parseCsv('a,b,c\n, x ,\n').rows, [['', ' x ', '']]);
});

test('refuses a character after a closing quote', () => {
  assert.throws(() => parseCsv('a\n"x"y\n'), { message: 'unexpected character after closing quote: y', code: 'data' });
});

test('refuses a quoted field the document never closes', () => {
  assert.throws(() => parseCsv('a\n"x\n'), { message: 'unterminated quoted field', code: 'data' });
});

test('refuses a document with no records', () => {
  assert.throws(() => parseCsv(''), { message: 'input has no header record', code: 'data' });
});

test('refuses a repeated header name', () => {
  assert.throws(() => parseCsv('a,a\n1,2\n'), { message: 'duplicate column: a', code: 'data' });
});

test('refuses a row whose width differs from the header', () => {
  assert.throws(() => parseCsv('a,b\n1,2\n3\n'), { message: 'row 2: expected 2 fields, got 1', code: 'data' });
});

test('quotes exactly the fields that need it', () => {
  assert.equal(escapeField('plain'), 'plain');
  assert.equal(escapeField('a,b'), '"a,b"');
  assert.equal(escapeField('say "hi"'), '"say ""hi"""');
  assert.equal(escapeField('two\nlines'), '"two\nlines"');
  assert.equal(escapeField(''), '');
});

test('writes one LF after every record, including the last', () => {
  assert.equal(formatCsv({ header: ['a', 'b'], rows: [['1', '2']] }), 'a,b\n1,2\n');
});

test('reads back exactly what it wrote', () => {
  const table = { header: ['a', 'b'], rows: [['x,y', 'say "hi"'], ['two\nlines', '']] };
  assert.deepEqual(parseCsv(formatCsv(table)), table);
});
