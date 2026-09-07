import { test } from 'node:test';
import assert from 'node:assert/strict';

import { comparator, compareValues, sortBy, sortIndices } from '../src/sortBy.js';

/**
 * Deterministic 32-bit PRNG.
 * @param {number} seed Initial state.
 * @returns {() => number} Generator returning floats in [0, 1).
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Type ranks used by the independent model. */
const RANK = { number: 0, string: 1, boolean: 2 };

/**
 * Model test for absent values.
 * @param {unknown} value Value to classify.
 * @returns {boolean} True for null, undefined, and NaN.
 */
function absent(value) {
  return value === null || value === undefined || (typeof value === 'number' && Number.isNaN(value));
}

/**
 * Model comparison of two present values.
 * @param {unknown} a First value.
 * @param {unknown} b Second value.
 * @returns {number} Negative, zero, or positive.
 */
function modelCompareValues(a, b) {
  if (RANK[typeof a] !== RANK[typeof b]) return RANK[typeof a] - RANK[typeof b];
  if (typeof a === 'string') {
    const left = [...a].map((c) => c.codePointAt(0));
    const right = [...b].map((c) => c.codePointAt(0));
    for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
      if (left[i] !== right[i]) return left[i] - right[i];
    }
    return left.length - right.length;
  }
  if (typeof a === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
  return a === b ? 0 : a < b ? -1 : 1;
}

/**
 * Independent stable multi-key sort used as the model.
 * @param {object[]} rows Rows to order.
 * @param {object[]} specs Key specs.
 * @returns {object[]} Sorted copy.
 */
function modelSort(rows, specs) {
  const read = (row, key) => (typeof key === 'function' ? key(row) : key.split('.').reduce((v, p) => (v == null ? undefined : v[p]), row));
  const compare = (a, b) => {
    for (const spec of specs) {
      const left = read(a, spec.key);
      const right = read(b, spec.key);
      if (absent(left) || absent(right)) {
        if (absent(left) && absent(right)) continue;
        const nullsFirst = (spec.nulls ?? 'last') === 'first';
        return (absent(left) ? -1 : 1) * (nullsFirst ? 1 : -1);
      }
      const order = modelCompareValues(left, right);
      if (order !== 0) return order * ((spec.direction ?? 'asc') === 'asc' ? 1 : -1);
    }
    return 0;
  };
  const items = rows.map((row, index) => ({ row, index }));
  for (let i = 1; i < items.length; i += 1) {
    const item = items[i];
    let j = i - 1;
    while (j >= 0 && compare(items[j].row, item.row) > 0) {
      items[j + 1] = items[j];
      j -= 1;
    }
    items[j + 1] = item;
  }
  return items.map((item) => item.row);
}

test('compareValues orders absent values first, then by type rank', () => {
  assert.equal(compareValues(null, 3), -1);
  assert.equal(compareValues(3, undefined), 1);
  assert.equal(compareValues(null, undefined), 0);
  assert.equal(compareValues(Number.NaN, null), 0);
  assert.equal(compareValues(Number.NaN, -5), -1);
  assert.equal(compareValues(9, 'a'), -1);
  assert.equal(compareValues('a', false), -1);
});

test('compareValues is locale-free and compares strings by code point', () => {
  assert.ok(compareValues('A', 'a') < 0);
  assert.ok(compareValues('apple', 'Apple') > 0);
  assert.ok(compareValues('ab', 'abc') < 0);
  assert.ok(compareValues('', 'a') < 0);
  assert.ok(compareValues('\u{1F600}', '\uFFFD') > 0);
  assert.ok(compareValues('\uFF10', '\u{1F600}') < 0);
  assert.equal(compareValues('e\u0301', 'e\u0301'), 0);
  assert.ok(compareValues('e\u0301', '\u00E9') < 0);
});

test('compareValues handles numeric and boolean edges', () => {
  assert.equal(compareValues(-0, 0), 0);
  assert.equal(compareValues(0, 1e-9), -1);
  assert.equal(compareValues(Number.NEGATIVE_INFINITY, -1e308), -1);
  assert.equal(compareValues(false, true), -1);
  assert.throws(() => compareValues({}, 1), { name: 'TypeError', message: 'unsupported value type: object' });
  assert.throws(() => compareValues(1, () => 1), { name: 'TypeError', message: 'unsupported value type: function' });
  assert.throws(() => compareValues(1n, 2), { name: 'TypeError', message: 'unsupported value type: bigint' });
});

test('sortBy orders by one key and leaves the input untouched', () => {
  const rows = [{ n: 3 }, { n: 1 }, { n: 2 }];
  const sorted = sortBy(rows, [{ key: 'n' }]);
  assert.deepEqual(sorted.map((r) => r.n), [1, 2, 3]);
  assert.deepEqual(rows.map((r) => r.n), [3, 1, 2]);
  assert.notEqual(sorted, rows);
  assert.equal(sorted[0], rows[1]);
  assert.deepEqual(sortBy(rows, [{ key: 'n', direction: 'desc' }]).map((r) => r.n), [3, 2, 1]);
  assert.deepEqual(sortBy([], [{ key: 'n' }]), []);
});

test('sortBy is stable in both directions', () => {
  const rows = [
    { g: 'x', id: 0 }, { g: 'y', id: 1 }, { g: 'x', id: 2 },
    { g: 'y', id: 3 }, { g: 'x', id: 4 }, { g: 'y', id: 5 },
  ];
  assert.deepEqual(sortBy(rows, [{ key: 'g' }]).map((r) => r.id), [0, 2, 4, 1, 3, 5]);
  assert.deepEqual(sortBy(rows, [{ key: 'g', direction: 'desc' }]).map((r) => r.id), [1, 3, 5, 0, 2, 4]);
  const flat = Array.from({ length: 40 }, (_, id) => ({ g: 0, id }));
  assert.deepEqual(sortBy(flat, [{ key: 'g', direction: 'desc' }]).map((r) => r.id), flat.map((r) => r.id));
  assert.deepEqual(sortIndices(flat, [{ key: 'g' }]), flat.map((_, i) => i));
});

test('null placement is independent of direction', () => {
  const rows = [{ v: 2 }, { v: null }, { v: 1 }, { v: undefined }, { v: Number.NaN }];
  const label = (list) => list.map((r) => (typeof r.v === 'number' && !Number.isNaN(r.v) ? r.v : 'nil'));
  assert.deepEqual(label(sortBy(rows, [{ key: 'v' }])), [1, 2, 'nil', 'nil', 'nil']);
  assert.deepEqual(label(sortBy(rows, [{ key: 'v', nulls: 'first' }])), ['nil', 'nil', 'nil', 1, 2]);
  assert.deepEqual(label(sortBy(rows, [{ key: 'v', direction: 'desc' }])), [2, 1, 'nil', 'nil', 'nil']);
  assert.deepEqual(label(sortBy(rows, [{ key: 'v', direction: 'desc', nulls: 'first' }])), ['nil', 'nil', 'nil', 2, 1]);
  assert.deepEqual(sortBy(rows, [{ key: 'v', nulls: 'first' }]).slice(0, 3).map((r) => rows.indexOf(r)), [1, 3, 4]);
});

test('multiple keys apply in order with per-key direction and paths', () => {
  const rows = [
    { user: { last: 'Ng', first: 'Bo' }, score: 5 },
    { user: { last: 'ng', first: 'Al' }, score: 9 },
    { user: { last: 'Ng', first: 'Al' }, score: 7 },
    { user: { last: 'Ng' }, score: 9 },
  ];
  const out = sortBy(rows, [{ key: 'user.last' }, { key: 'user.first', nulls: 'first' }]);
  assert.deepEqual(out.map((r) => r.score), [9, 7, 5, 9]);
  const byScore = sortBy(rows, [{ key: 'score', direction: 'desc' }, { key: 'user.first' }]);
  assert.deepEqual(byScore.map((r) => r.user.first), ['Al', undefined, 'Al', 'Bo']);
  const byLength = sortBy(rows, [{ key: (row) => row.user.last.length }, { key: 'score', direction: 'desc' }]);
  assert.deepEqual(byLength.map((r) => r.score), [9, 9, 7, 5]);
  assert.deepEqual(sortBy(rows, [{ key: 'missing.deep.path' }]).map((r) => r.score), [5, 9, 7, 9]);
});

test('comparator and sortIndices agree with sortBy', () => {
  const rows = [{ a: 2, b: 'x' }, { a: 1, b: 'y' }, { a: 2, b: 'a' }];
  const specs = [{ key: 'a' }, { key: 'b', direction: 'desc' }];
  const compare = comparator(specs);
  assert.equal(compare(rows[0], rows[1]) > 0, true);
  assert.equal(compare(rows[0], rows[2]) < 0, true);
  assert.equal(compare(rows[0], rows[0]), 0);
  assert.deepEqual(sortIndices(rows, specs), [1, 0, 2]);
  assert.deepEqual(sortBy(rows, specs), sortIndices(rows, specs).map((i) => rows[i]));
});

test('malformed arguments raise the specified errors', () => {
  assert.throws(() => sortBy('nope', [{ key: 'a' }]), { name: 'TypeError', message: 'rows must be an array' });
  assert.throws(() => sortBy([], []), { name: 'TypeError', message: 'at least one key spec is required' });
  assert.throws(() => sortBy([], { key: 'a' }), { name: 'TypeError', message: 'at least one key spec is required' });
  assert.throws(() => comparator([null]), { name: 'TypeError', message: 'key spec must be an object' });
  assert.throws(() => comparator([{ key: 7 }]), { name: 'TypeError', message: 'key must be a string path or a function' });
  assert.throws(() => comparator([{}]), { name: 'TypeError', message: 'key must be a string path or a function' });
  assert.throws(() => comparator([{ key: 'a', direction: 'up' }]), { name: 'RangeError', message: 'unknown direction: "up"' });
  assert.throws(() => sortBy([], [{ key: 'a', nulls: 'middle' }]), { name: 'RangeError', message: 'unknown null placement: "middle"' });
  assert.throws(() => sortBy([{ a: {} }, { a: 1 }], [{ key: 'a' }]), { name: 'TypeError', message: 'unsupported value type: object' });
});

test('matches an independent stable model on random rows and specs', () => {
  const rnd = mulberry32(0x51de);
  const strings = ['', 'a', 'A', 'ab', 'B', '\u017A', '\u00E9', 'e\u0301', '\uFF10', '\uFFFD', '\u{1F600}', '\u{1F600}a'];
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  for (let round = 0; round < 200; round += 1) {
    const rows = [];
    for (let i = 0; i < 12; i += 1) {
      const kind = Math.floor(rnd() * 6);
      const value = kind === 0 ? null : kind === 1 ? undefined : kind === 2 ? Number.NaN
        : kind === 3 ? Math.floor(rnd() * 4) - 1 : kind === 4 ? pick(strings) : rnd() < 0.5;
      rows.push({ v: value, group: Math.floor(rnd() * 3), nested: { deep: pick(strings) }, id: i });
    }
    const specs = [];
    const keys = ['v', 'group', 'nested.deep'];
    const count = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < count; i += 1) {
      specs.push({
        key: keys[i % keys.length],
        direction: rnd() < 0.5 ? 'asc' : 'desc',
        nulls: rnd() < 0.5 ? 'first' : 'last',
      });
    }
    const got = sortBy(rows, specs);
    assert.deepEqual(got.map((r) => r.id), modelSort(rows, specs).map((r) => r.id), `round ${round} ${JSON.stringify(specs)}`);
    assert.deepEqual(sortIndices(rows, specs), got.map((r) => r.id), `indices round ${round}`);
    const compare = comparator(specs);
    for (let i = 1; i < got.length; i += 1) {
      assert.ok(compare(got[i - 1], got[i]) <= 0, `sorted round ${round} at ${i}`);
      if (compare(got[i - 1], got[i]) === 0) assert.ok(got[i - 1].id < got[i].id, `stable round ${round} at ${i}`);
    }
  }
});
