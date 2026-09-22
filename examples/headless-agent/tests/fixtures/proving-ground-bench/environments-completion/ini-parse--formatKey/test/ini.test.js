import test from 'node:test';
import assert from 'node:assert/strict';

import { IniError, formatKey, formatValue, parse, stringify } from '../src/ini.js';

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

function throws(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

test('parses globals and sections', () => {
  const doc = parse('a=1\n[server]\nhost=localhost\nport=8080\n');
  assert.deepStrictEqual(doc.global, { a: '1' });
  assert.deepStrictEqual(doc.sections, { server: { host: 'localhost', port: '8080' } });
});

test('empty input yields an empty document', () => {
  assert.deepStrictEqual(parse(''), { global: {}, sections: {} });
  assert.deepStrictEqual(parse('\n\n   \n'), { global: {}, sections: {} });
});

test('comments are recognised only at the start of a trimmed line', () => {
  const doc = parse('; a comment\n   # another\nk=v ; not a comment\nj=v # neither\n');
  assert.deepStrictEqual(doc.global, { k: 'v ; not a comment', j: 'v # neither' });
});

test('whitespace around keys and values is stripped, quoted whitespace is kept', () => {
  const doc = parse('  key   =   value  \n pad = "  padded  "\n');
  assert.deepStrictEqual(doc.global, { key: 'value', pad: '  padded  ' });
});

test('an unquoted value keeps interior characters verbatim', () => {
  const doc = parse('path=C:\\Users\\x\nempty=\nsymbols=a=b=c\n');
  assert.deepStrictEqual(doc.global, { path: 'C:\\Users\\x', empty: '', symbols: 'a=b=c' });
});

test('escape sequences are decoded inside quotes', () => {
  const doc = parse('a="x\\ny"\nb="\\t\\\\\\""\nc="\\0"\nd="\\;\\#\\=\\[\\]"\ne="caf\\u00e9"\n');
  assert.deepStrictEqual(doc.global, { a: 'x\ny', b: '\t\\"', c: '\0', d: ';#=[]', e: 'café' });
});

test('quoted keys and section names may contain separators', () => {
  const doc = parse('"a=b" = 1\n["x]y"]\n"k[0]"=2\n');
  assert.deepStrictEqual(doc.global, { 'a=b': '1' });
  assert.deepStrictEqual(doc.sections, { 'x]y': { 'k[0]': '2' } });
});

test('CRLF and lone CR terminate lines', () => {
  assert.deepStrictEqual(parse('a=1\r\nb=2\r\n').global, { a: '1', b: '2' });
  assert.deepStrictEqual(parse('a=1\rb=2').global, { a: '1', b: '2' });
});

test('astral characters survive parsing', () => {
  assert.deepStrictEqual(parse('emoji=a😀b\nquoted="😀\\t"\n').global, { emoji: 'a😀b', quoted: '😀\t' });
});

test('repeated section headers reuse the same body', () => {
  const doc = parse('[a]\nx=1\n[b]\ny=2\n[a]\nz=3\n');
  assert.deepStrictEqual(doc.sections, { a: { x: '1', z: '3' }, b: { y: '2' } });
  assert.deepStrictEqual(Object.keys(doc.sections), ['a', 'b']);
});

test('keys shadowing Object.prototype stay own properties', () => {
  const doc = parse('__proto__=x\n[constructor]\ntoString=y\n');
  assert.deepStrictEqual(doc.global, { ['__proto__']: 'x' });
  assert.equal(Object.getPrototypeOf(doc.global), Object.prototype);
  assert.equal(doc.sections.constructor.toString, 'y');
  assert.equal(stringify(doc), '__proto__=x\n\n[constructor]\ntoString=y\n');
});

test('duplicate keys follow the configured policy', () => {
  const text = '[s]\nk=1\nk=2\nk=3\n';
  assert.equal(parse(text).sections.s.k, '3');
  assert.equal(parse(text, { duplicates: 'last' }).sections.s.k, '3');
  assert.equal(parse(text, { duplicates: 'first' }).sections.s.k, '1');
  assert.deepStrictEqual(parse(text, { duplicates: 'array' }).sections.s.k, ['1', '2', '3']);
  const error = throws(() => parse(text, { duplicates: 'error' }));
  assert.equal(error.name, 'IniError');
  assert.match(error.message, /duplicate key: k/);
  assert.equal(error.line, 3);
});

test('the array policy leaves single occurrences as strings', () => {
  const doc = parse('a=1\nb=2\nb=3\n', { duplicates: 'array' });
  assert.equal(doc.global.a, '1');
  assert.deepStrictEqual(doc.global.b, ['2', '3']);
});

test('the same key in different sections is not a duplicate', () => {
  const doc = parse('[a]\nk=1\n[b]\nk=2\n', { duplicates: 'error' });
  assert.deepStrictEqual(doc.sections, { a: { k: '1' }, b: { k: '2' } });
});

test('malformed documents report the reason and the line', () => {
  const cases = [
    ['a=1\n[unclosed\n', /unterminated section header/, 2],
    ['\n\nk\n', /missing '=' in entry/, 3],
    ['  =1\n', /empty key/, 1],
    ['[]\n', /empty section name/, 1],
    ['[  ]\n', /empty section name/, 1],
    ['a="oops\n', /unterminated quoted string/, 1],
    ['a="x\\\n', /unterminated quoted string/, 1],
    ['a="x\\q"\n', /unknown escape sequence: \\q/, 1],
    ['a="\\u12g4"\n', /invalid unicode escape/, 1],
    ['a="x" trailing\n', /unexpected text after quoted value/, 1],
    ['"k" oops = 1\n', /unexpected text after quoted key/, 1],
    ['"k"\n', /missing '=' in entry/, 1],
    ['["s" oops]\n', /unexpected text after quoted section name/, 1],
  ];
  for (const [text, pattern, line] of cases) {
    const error = throws(() => parse(text));
    assert.ok(error instanceof IniError, `expected IniError for ${JSON.stringify(text)}`);
    assert.match(error.message, pattern);
    assert.equal(error.line, line, `line for ${JSON.stringify(text)}`);
  }
});

test('non-string input and unknown policies are rejected', () => {
  assert.throws(() => parse(null), IniError);
  assert.throws(() => parse(['a=1']), IniError);
  assert.throws(() => parse('a=1', { duplicates: 'merge' }), /unknown duplicates policy: merge/);
});

test('formatValue quotes exactly the values that need it', () => {
  const cases = [
    ['plain', 'plain'],
    ['with space', 'with space'],
    ['', '""'],
    [' pad ', '" pad "'],
    ['a;b', '"a;b"'],
    ['a#b', '"a#b"'],
    ['a=b', '"a=b"'],
    ['[x]', '"[x]"'],
    ['x[1]', 'x[1]'],
    ['a"b', '"a\\"b"'],
    ['a\\b', '"a\\\\b"'],
    ['a\nb', '"a\\nb"'],
    ['a\tb', '"a\\tb"'],
    ['a\0b', '"a\\0b"'],
    ['😀', '😀'],
  ];
  for (const [value, expected] of cases) assert.equal(formatValue(value), expected, `formatValue(${JSON.stringify(value)})`);
});

test('formatKey quotes separators and bracket characters', () => {
  const cases = [
    ['plain', 'plain'],
    ['a b', 'a b'],
    ['a=b', '"a=b"'],
    ['[a]', '"[a]"'],
    ['x[1]', '"x[1]"'],
    [' a', '" a"'],
    [';a', '";a"'],
  ];
  for (const [key, expected] of cases) assert.equal(formatKey(key), expected, `formatKey(${JSON.stringify(key)})`);
});

test('stringify writes globals first and blank-line separated sections', () => {
  const text = stringify({ global: { a: '1' }, sections: { s: { b: '2' }, t: { c: '3' } } });
  assert.equal(text, 'a=1\n\n[s]\nb=2\n\n[t]\nc=3\n');
});

test('stringify handles missing halves, empty documents and the eol option', () => {
  assert.equal(stringify({}), '');
  assert.equal(stringify({ global: {}, sections: {} }), '');
  assert.equal(stringify({ sections: { s: {} } }), '[s]\n');
  assert.equal(stringify({ global: { a: '1' } }), 'a=1\n');
  assert.equal(stringify({ global: { a: '1' }, sections: { s: { b: '2' } } }, { eol: '\r\n' }), 'a=1\r\n\r\n[s]\r\nb=2\r\n');
});

test('stringify expands arrays into repeated entries', () => {
  assert.equal(stringify({ global: { k: ['1', '2'] } }), 'k=1\nk=2\n');
  assert.deepStrictEqual(parse(stringify({ global: { k: ['1', '2'] } }), { duplicates: 'array' }).global.k, ['1', '2']);
});

test('stringify rejects empty names and non-string values', () => {
  assert.throws(() => stringify({ global: { '': 'x' } }), /empty key/);
  assert.throws(() => stringify({ sections: { '': {} } }), /empty section name/);
  assert.throws(() => stringify({ global: { a: 1 } }), /value must be a string/);
  assert.throws(() => stringify({ global: { a: null } }), /value must be a string/);
  assert.throws(() => stringify(null), /document must be an object/);
});

test('a hand written document round-trips through both directions', () => {
  const doc = { global: { ' spaced ': 'v', 'a=b': ';#' }, sections: {} };
  doc.sections['x]y'] = { 'k\n': 'line\nbreak', tab: '\t', empty: '' };
  const text = stringify(doc);
  assert.deepStrictEqual(parse(text), doc);
  assert.equal(stringify(parse(text)), text);
});

test('round-trip holds for generated documents', () => {
  const random = mulberry32(0x5eed);
  const alphabet = ['a', 'Z', '0', ' ', '=', ';', '#', '[', ']', '"', '\\', '\n', '\t', '\0', 'é', '😀', '\r'];
  const pick = (list) => list[Math.floor(random() * list.length)];
  const text = (min) => {
    const length = min + Math.floor(random() * 4);
    let out = '';
    for (let i = 0; i < length; i += 1) out += pick(alphabet);
    return out;
  };

  let checked = 0;
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const doc = { global: {}, sections: {} };
    const globals = Math.floor(random() * 3);
    for (let i = 0; i < globals; i += 1) doc.global[text(1)] = text(0);
    const sections = Math.floor(random() * 3);
    for (let i = 0; i < sections; i += 1) {
      const body = {};
      const entries = Math.floor(random() * 3);
      for (let j = 0; j < entries; j += 1) body[text(1)] = text(0);
      doc.sections[text(1)] = body;
    }
    const serialised = stringify(doc);
    assert.deepStrictEqual(parse(serialised), doc, `round-trip failed for ${JSON.stringify(serialised)}`);
    assert.equal(stringify(parse(serialised)), serialised);
    checked += 1;
  }
  assert.equal(checked, 200);
});

test('generated values survive quoting in isolation', () => {
  const random = mulberry32(99);
  const alphabet = ['x', ' ', '"', '\\', '\n', '\r', '\t', '\0', ';', '#', '=', '[', ']', 'ß', '😀'];
  for (let i = 0; i < 150; i += 1) {
    let value = '';
    const length = Math.floor(random() * 5);
    for (let j = 0; j < length; j += 1) value += alphabet[Math.floor(random() * alphabet.length)];
    assert.equal(parse(`k=${formatValue(value)}`).global.k, value, `value ${JSON.stringify(value)}`);
  }
});
