import test from 'node:test';
import assert from 'node:assert/strict';

import { extract, parse, stringify } from '../src/query-string.js';

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

test('flat pairs, prefixes and empty segments', () => {
  const cases = [
    ['a=1&b=2', { a: '1', b: '2' }],
    ['?a=1', { a: '1' }],
    ['#a=1', { a: '1' }],
    ['', {}],
    ['&&', {}],
    ['a=1&&b=2', { a: '1', b: '2' }],
    ['a=', { a: '' }],
    ['a', { a: '' }],
    ['=1', { '': '1' }],
    ['a=1=2', { a: '1=2' }],
  ];
  for (const [input, expected] of cases) assert.deepStrictEqual(parse(input), expected, JSON.stringify(input));
});

test('percent escapes are decoded after the pair is split', () => {
  const cases = [
    ['a%3Db=c', { 'a=b': 'c' }],
    ['a=b%3Dc', { a: 'b=c' }],
    ['a%5Bb%5D=c', { 'a[b]': 'c' }],
    ['a%26b=c%26d', { 'a&b': 'c&d' }],
    ['caf%C3%A9=%F0%9F%98%80', { café: '\u{1f600}' }],
    ['a%ZZ=b%ZZ', { 'a%ZZ': 'b%ZZ' }],
    ['a%2520=b', { 'a%20': 'b' }],
  ];
  for (const [input, expected] of cases) assert.deepStrictEqual(parse(input), expected, input);
});

test('a plus sign is a space in keys and in values', () => {
  assert.deepStrictEqual(parse('a+b=c+d'), { 'a b': 'c d' });
  assert.deepStrictEqual(parse('a%2Bb=c%2Bd'), { 'a+b': 'c+d' });
  assert.deepStrictEqual(parse('a+b=c+d', { plusAsSpace: false }), { 'a+b': 'c+d' });
  assert.deepStrictEqual(parse('x[a+b]=1'), { x: { 'a b': '1' } });
});

test('bracket keys nest and empty brackets append', () => {
  const cases = [
    ['a[b]=1', { a: { b: '1' } }],
    ['a[b][c]=1', { a: { b: { c: '1' } } }],
    ['a[]=1&a[]=2', { a: ['1', '2'] }],
    ['a[0]=x&a[1]=y', { a: ['x', 'y'] }],
    ['a[1]=y&a[0]=x', { a: ['x', 'y'] }],
    ['a[0]=x&a[2]=y', { a: ['x', 'y'] }],
    ['a[b][]=1&a[b][]=2', { a: { b: ['1', '2'] } }],
    ['a[]=1&a[b]=2', { a: { 0: '1', b: '2' } }],
    ['a=1&a=2&a=3', { a: ['1', '2', '3'] }],
    ['a[01]=x', { a: { '01': 'x' } }],
    ['a[-1]=x', { a: { '-1': 'x' } }],
    ['a[b=1', { a: { '[b': '1' } }],
    ['a[]b=1', { a: [{ b: '1' }] }],
  ];
  for (const [input, expected] of cases) assert.deepStrictEqual(parse(input), expected, input);
});

test('the array limit decides between an array and an object', () => {
  assert.deepStrictEqual(parse('a[19]=x'), { a: ['x'] });
  assert.deepStrictEqual(parse('a[20]=x'), { a: { 20: 'x' } });
  assert.deepStrictEqual(parse('a[4]=x', { arrayLimit: 5 }), { a: ['x'] });
  assert.deepStrictEqual(parse('a[5]=x', { arrayLimit: 5 }), { a: { 5: 'x' } });
  assert.deepStrictEqual(parse('a[0]=x', { arrayLimit: 0 }), { a: { 0: 'x' } });
});

test('nesting stops at the configured depth', () => {
  assert.deepStrictEqual(parse('a[b][c]=1', { depth: 1 }), { a: { b: { '[c]': '1' } } });
  assert.deepStrictEqual(parse('a[b][c]=1', { depth: 0 }), { a: { '[b][c]': '1' } });
  assert.deepStrictEqual(parse('a[b][c][d][e][f][g]=1'), { a: { b: { c: { d: { e: { f: { '[g]': '1' } } } } } } });
});

test('parse returns a fresh result that no earlier call can see', () => {
  const first = parse('a=1&b[c]=2');
  first.a = 'mutated';
  first.b.c = 'mutated';
  assert.deepStrictEqual(parse('a=1&b[c]=2'), { a: '1', b: { c: '2' } });
  assert.deepStrictEqual(parse('a[20]=x'), { a: { 20: 'x' } });
  assert.deepStrictEqual(parse('a[20]=x', { arrayLimit: 25 }), { a: ['x'] });
  assert.deepStrictEqual(parse('a[b][c]=1'), { a: { b: { c: '1' } } });
  assert.deepStrictEqual(parse('a[b][c]=1', { depth: 1 }), { a: { b: { '[c]': '1' } } });
});

test('keys that shadow Object.prototype stay own properties', () => {
  const result = parse('__proto__[x]=1&constructor=2');
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.deepStrictEqual(Object.keys(result).sort(), ['__proto__', 'constructor']);
  assert.equal({}.x, undefined);
});

test('stringify writes scalars, nulls and missing values', () => {
  const cases = [
    [{ a: '1', b: '2' }, {}, 'a=1&b=2'],
    [{}, {}, ''],
    [{ a: '' }, {}, 'a='],
    [{ a: null }, {}, 'a'],
    [{ a: null, b: '1' }, { skipNull: true }, 'b=1'],
    [{ a: undefined, b: '1' }, {}, 'b=1'],
    [{ a: 0, b: false }, {}, 'a=0&b=false'],
    [{ a: 'x y' }, {}, 'a=x%20y'],
    [{ a: 'x y' }, { space: 'plus' }, 'a=x+y'],
    [{ 'a b': 'c' }, {}, 'a%20b=c'],
    [{ a: "!'()*" }, {}, 'a=%21%27%28%29%2A'],
    [{ a: '\u{1f600}' }, {}, 'a=%F0%9F%98%80'],
    [{ 'k[0]': 'v' }, {}, 'k%5B0%5D=v'],
    [{ '': 'v' }, {}, '=v'],
  ];
  for (const [input, options, expected] of cases) {
    assert.equal(stringify(input, options), expected, JSON.stringify(input));
  }
});

test('stringify nests objects and formats arrays three ways', () => {
  const cases = [
    [{ a: { b: 'x' } }, {}, 'a[b]=x'],
    [{ a: { b: { c: 'x' } } }, {}, 'a[b][c]=x'],
    [{ a: ['x', 'y'] }, {}, 'a[0]=x&a[1]=y'],
    [{ a: ['x', 'y'] }, { arrayFormat: 'brackets' }, 'a[]=x&a[]=y'],
    [{ a: ['x', 'y'] }, { arrayFormat: 'repeat' }, 'a=x&a=y'],
    [{ a: [] }, {}, ''],
    [{ a: {} }, {}, ''],
    [{ a: [{ b: 'x' }] }, {}, 'a[0][b]=x'],
    [{ a: [['x']] }, {}, 'a[0][0]=x'],
    [{ a: { 'b c': 'x' } }, {}, 'a[b%20c]=x'],
  ];
  for (const [input, options, expected] of cases) {
    assert.equal(stringify(input, options), expected, JSON.stringify(input));
  }
});

test('sorting orders every pair by its whole written key', () => {
  assert.equal(stringify({ b: '1', a: '2' }), 'b=1&a=2');
  assert.equal(stringify({ b: '1', a: '2' }, { sort: true }), 'a=2&b=1');
  assert.equal(stringify({ b: { z: '1', a: '2' }, a: '3' }, { sort: true }), 'a=3&b[a]=2&b[z]=1');
  assert.equal(stringify({ a: '1', B: '2', b: '3', A: '4' }, { sort: true }), 'A=4&B=2&a=1&b=3');
  assert.equal(stringify({ a: ['y', 'x'] }, { sort: true }), 'a[0]=y&a[1]=x');
});

test('bad arguments are rejected', () => {
  assert.throws(() => parse(null), TypeError);
  assert.throws(() => parse(['a=1']), /input must be a string/);
  assert.throws(() => stringify('a=1'), /input must be an object/);
  assert.throws(() => stringify(['a']), /input must be an object/);
  assert.throws(() => stringify({}, { arrayFormat: 'comma' }), /unknown arrayFormat: comma/);
  assert.throws(() => stringify({}, { space: 'tab' }), /unknown space: tab/);
  assert.throws(() => extract(null), /url must be a string/);
});

test('extract takes the query out of a URL', () => {
  const cases = [
    ['http://x/y?a=1&b=2', 'a=1&b=2'],
    ['http://x/y?a=1#frag', 'a=1'],
    ['http://x/y#frag?a=1', ''],
    ['http://x/y', ''],
    ['?a=1', 'a=1'],
    ['http://x/y?', ''],
  ];
  for (const [url, expected] of cases) assert.equal(extract(url), expected, url);
});

test('generated parameters round-trip', () => {
  const random = mulberry32(0x00b51e);
  const keys = ['a', 'b', 'x y', 'k[0]', 'é', '', '+p', '%', 'zz'];
  const alphabet = ['x', 'Y', '1', ' ', '&', '=', '[', ']', '+', '%', '/', 'ü', '\u{1f600}', ''];

  const text = () => {
    let out = '';
    const length = Math.floor(random() * 4);
    for (let i = 0; i < length; i += 1) out += alphabet[Math.floor(random() * alphabet.length)];
    return out;
  };

  const grow = (depth) => {
    const roll = random();
    if (depth === 0 || roll < 0.5) return text();
    if (roll < 0.75) {
      const items = [];
      const length = 1 + Math.floor(random() * 3);
      for (let i = 0; i < length; i += 1) items.push(grow(depth - 1));
      return items;
    }
    const object = {};
    const size = 1 + Math.floor(random() * 3);
    for (let i = 0; i < size; i += 1) object[`n${keys[Math.floor(random() * keys.length)]}`] = grow(depth - 1);
    return object;
  };

  for (let iteration = 0; iteration < 250; iteration += 1) {
    const input = {};
    const size = 1 + Math.floor(random() * 4);
    for (let i = 0; i < size; i += 1) input[keys[Math.floor(random() * keys.length)]] = grow(2);
    const written = stringify(input);
    assert.deepStrictEqual(parse(written), input, `round-trip failed for ${written}`);
    const plus = stringify(input, { space: 'plus' });
    assert.deepStrictEqual(parse(plus), input, `round-trip failed for ${plus}`);
  }
});
