import test from 'node:test';
import assert from 'node:assert/strict';

import { CsvError, escapeField, parse, stringify } from '../src/csv.js';

/** Deterministic 32-bit PRNG so the generated cases are identical on every run. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function caught(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

test('reads plain records', () => {
  assert.deepStrictEqual(parse('a,b,c\n1,2,3\n'), [
    ['a', 'b', 'c'],
    ['1', '2', '3'],
  ]);
});

test('record termination', () => {
  const cases = [
    ['a\n', [['a']]],
    ['a', [['a']]],
    ['a\n\n', [['a'], ['']]],
    ['\n', [['']]],
    ['a,b\r\nc,d', [['a', 'b'], ['c', 'd']]],
    ['a\rb', [['a'], ['b']]],
    ['a\r\n', [['a']]],
    ['a\n\rb\n', [['a'], [''], ['b']]],
  ];
  for (const [text, expected] of cases) assert.deepStrictEqual(parse(text), expected, JSON.stringify(text));
});

test('the shape of a document', () => {
  const cases = [
    ['', []],
    ['\ufeff', []],
    ['\ufeffa,b\n', [['a', 'b']]],
    ['a,\ufeffb\n', [['a', '\ufeffb']]],
    ['a,,b', [['a', '', 'b']]],
    [',', [['', '']]],
    ['a,', [['a', '']]],
    [',a', [['', 'a']]],
  ];
  for (const [text, expected] of cases) assert.deepStrictEqual(parse(text), expected, JSON.stringify(text));
});

test('quoted fields carry delimiters, terminators and doubled quotes', () => {
  const cases = [
    ['"a,b",c\n', [['a,b', 'c']]],
    ['"line\nbreak",x\n', [['line\nbreak', 'x']]],
    ['"a""b"\n', [['a"b']]],
    ['"",""\n', [['', '']]],
    ['"a\r\nb"', [['a\r\nb']]],
    [' "a",b', [[' "a"', 'b']]],
    ['a"b,c', [['a"b', 'c']]],
  ];
  for (const [text, expected] of cases) assert.deepStrictEqual(parse(text), expected, JSON.stringify(text));
});

test('fields are never trimmed', () => {
  assert.deepStrictEqual(parse(' a , b \n'), [[' a ', ' b ']]);
});

test('astral characters and combining marks survive without normalisation', () => {
  assert.deepStrictEqual(parse('\u{1f600},"caf\u00e9",cafe\u0301\n'), [['\u{1f600}', 'caf\u00e9', 'cafe\u0301']]);
});

test('an unterminated quoted field reports the opening quote', () => {
  const error = caught(() => parse('a,b\nc,"d,e'));
  assert.ok(error instanceof CsvError);
  assert.match(error.message, /unterminated quoted field/);
  assert.equal(error.line, 2);
  assert.equal(error.column, 3);
});

test('text after a closing quote reports its own position', () => {
  const first = caught(() => parse('"a"b'));
  assert.match(first.message, /unexpected character after closing quote: b/);
  assert.equal(first.line, 1);
  assert.equal(first.column, 4);
  const later = caught(() => parse('x\n"a\nb"c'));
  assert.equal(later.line, 3);
  assert.equal(later.column, 3);
});

test('the dialect is configurable', () => {
  assert.deepStrictEqual(parse('a;b\n', { delimiter: ';' }), [['a', 'b']]);
  assert.deepStrictEqual(parse('a\tb\n', { delimiter: '\t' }), [['a', 'b']]);
  assert.deepStrictEqual(parse("'a;b';c", { delimiter: ';', quote: "'" }), [['a;b', 'c']]);
  assert.deepStrictEqual(parse('"a";b', { delimiter: ';', quote: "'" }), [['"a"', 'b']]);
});

test('an invalid dialect is rejected', () => {
  assert.throws(() => parse('a', { delimiter: ',,' }), /delimiter must be a single character/);
  assert.throws(() => parse('a', { delimiter: '' }), /delimiter must be a single character/);
  assert.throws(() => parse('a', { quote: 'ab' }), /quote must be a single character/);
  assert.throws(() => parse('a', { delimiter: ',', quote: ',' }), /delimiter and quote must differ/);
  assert.throws(() => parse('a', { delimiter: '\n' }), /must not be line terminators/);
  assert.throws(() => parse(42), /input must be a string/);
});

test('ragged records are allowed unless strictWidth is set', () => {
  assert.deepStrictEqual(parse('a,b\nc\n'), [['a', 'b'], ['c']]);
  const error = caught(() => parse('a,b\nc\nd,e\n', { strictWidth: true }));
  assert.match(error.message, /expected 2 fields, got 1/);
  assert.equal(error.line, 2);
  assert.deepStrictEqual(parse('a,b\nc,d\n', { strictWidth: true }), [
    ['a', 'b'],
    ['c', 'd'],
  ]);
});

test('escapeField quotes exactly the fields that need it', () => {
  const cases = [
    ['plain', 'plain'],
    ['', ''],
    [' pad ', ' pad '],
    ['a,b', '"a,b"'],
    ['a"b', '"a""b"'],
    ['"', '""""'],
    ['a\nb', '"a\nb"'],
    ['a\rb', '"a\rb"'],
    ['﻿x', '"﻿x"'],
    ['a;b', 'a;b'],
  ];
  for (const [value, expected] of cases) assert.equal(escapeField(value), expected, JSON.stringify(value));
  assert.equal(escapeField('a;b', { delimiter: ';' }), '"a;b"');
  assert.equal(escapeField('plain', { alwaysQuote: true }), '"plain"');
  assert.equal(escapeField("it's", { quote: "'" }), "'it''s'");
});

test('escapeField converts the accepted non-string values', () => {
  assert.equal(escapeField(null), '');
  assert.equal(escapeField(undefined), '');
  assert.equal(escapeField(0), '0');
  assert.equal(escapeField(-1.5), '-1.5');
  assert.equal(escapeField(false), 'false');
  assert.throws(() => escapeField(Number.NaN), /unsupported field value: NaN/);
  assert.throws(() => escapeField({}), /unsupported field type: object/);
  assert.throws(() => escapeField([1]), /unsupported field type: object/);
});

test('stringify terminates every record', () => {
  assert.equal(stringify([['a', 'b']]), 'a,b\r\n');
  assert.equal(stringify([]), '');
  assert.equal(stringify([['']]), '\r\n');
  assert.equal(stringify([['a']], { newline: '\n' }), 'a\n');
  assert.equal(stringify([['a']], { bom: true }), '﻿a\r\n');
  assert.equal(stringify([], { bom: true }), '﻿');
  assert.equal(stringify([['a', 'b']], { delimiter: ';', newline: '\n' }), 'a;b\n');
  assert.equal(stringify([['a', 'b']], { alwaysQuote: true, newline: '\n' }), '"a","b"\n');
});

test('stringify rejects malformed input', () => {
  assert.throws(() => stringify('a,b'), /rows must be an array/);
  assert.throws(() => stringify([['a'], 'b']), /record 1 is not an array/);
  assert.throws(() => stringify([[]]), /record 0 has no fields/);
  assert.throws(() => stringify([['a']], { newline: '\n\n' }), /newline must be a line terminator/);
});

test('a byte-order mark inside a field round-trips because it is quoted', () => {
  const rows = [['﻿a'], ['b']];
  assert.deepStrictEqual(parse(stringify(rows)), rows);
});

test('generated documents round-trip', () => {
  const random = mulberry32(20240517);
  const alphabet = ['a', 'B', '0', ' ', ',', '"', '\n', '\r', '\t', ';', 'é', '😀', ''];
  const dialects = [{}, { delimiter: ';' }, { quote: "'" }, { newline: '\n' }, { alwaysQuote: true }, { delimiter: '\t', quote: '`' }];

  for (let iteration = 0; iteration < 250; iteration += 1) {
    const rows = [];
    const records = 1 + Math.floor(random() * 4);
    for (let r = 0; r < records; r += 1) {
      const row = [];
      const fields = 1 + Math.floor(random() * 4);
      for (let f = 0; f < fields; f += 1) {
        let value = '';
        const length = Math.floor(random() * 5);
        for (let c = 0; c < length; c += 1) value += alphabet[Math.floor(random() * alphabet.length)];
        row.push(value);
      }
      rows.push(row);
    }
    const options = dialects[Math.floor(random() * dialects.length)];
    const text = stringify(rows, options);
    assert.deepStrictEqual(parse(text, options), rows, `round-trip failed for ${JSON.stringify(text)}`);
  }
});
