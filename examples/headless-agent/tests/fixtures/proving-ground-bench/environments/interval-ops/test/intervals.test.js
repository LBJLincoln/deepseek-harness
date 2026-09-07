import { test } from 'node:test';
import assert from 'node:assert/strict';

import { coverage, intersect, merge, normalize, subtract } from '../src/intervals.js';

/** Lower bound of the universe used by the model-based checks. */
const LO = -40;
/** Upper bound (exclusive) of the universe used by the model-based checks. */
const HI = 40;

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

/**
 * Rasterises an interval list over the model universe.
 * @param {Array<[number, number]>} list Interval list.
 * @returns {Uint8Array} One byte per integer in [LO, HI).
 */
function raster(list) {
  const bits = new Uint8Array(HI - LO);
  for (const [start, end] of list) {
    for (let x = Math.max(start, LO); x < Math.min(end, HI); x += 1) bits[x - LO] = 1;
  }
  return bits;
}

/**
 * Converts a raster back into a normalised interval list.
 * @param {Uint8Array} bits Raster.
 * @returns {Array<[number, number]>} Normalised list.
 */
function unraster(bits) {
  const out = [];
  let run = -1;
  for (let i = 0; i <= bits.length; i += 1) {
    const on = i < bits.length && bits[i] === 1;
    if (on && run < 0) run = i;
    if (!on && run >= 0) {
      out.push([run + LO, i + LO]);
      run = -1;
    }
  }
  return out;
}

/**
 * Asserts that a list is normalised: sorted, non-empty, disjoint, non-touching.
 * @param {Array<[number, number]>} list List under test.
 * @param {string} label Assertion label.
 * @returns {void}
 */
function assertNormalised(list, label) {
  for (let i = 0; i < list.length; i += 1) {
    assert.ok(list[i][0] < list[i][1], `${label}: empty interval at ${i}`);
    if (i > 0) assert.ok(list[i - 1][1] < list[i][0], `${label}: not disjoint at ${i}`);
  }
}

/**
 * Builds a random interval list.
 * @param {() => number} rnd Generator.
 * @param {number} count How many intervals.
 * @returns {Array<[number, number]>} Random intervals, possibly empty ones.
 */
function randomList(rnd, count) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const start = LO + Math.floor(rnd() * (HI - LO - 9));
    const width = Math.floor(rnd() * 9);
    out.push([start, start + width]);
  }
  return out;
}

test('normalize sorts, drops empties, and coalesces overlapping and touching intervals', () => {
  const cases = [
    { input: [], expected: [] },
    { input: [[3, 3]], expected: [] },
    { input: [[5, 9]], expected: [[5, 9]] },
    { input: [[1, 3], [3, 5]], expected: [[1, 5]] },
    { input: [[1, 3], [4, 5]], expected: [[1, 3], [4, 5]] },
    { input: [[4, 5], [1, 3]], expected: [[1, 3], [4, 5]] },
    { input: [[0, 10], [2, 3]], expected: [[0, 10]] },
    { input: [[2, 3], [0, 10]], expected: [[0, 10]] },
    { input: [[1, 4], [2, 6], [6, 7], [9, 9]], expected: [[1, 7]] },
    { input: [[-8, -4], [-4, -1], [-1, 0]], expected: [[-8, 0]] },
    { input: [[2, 2], [2, 2]], expected: [] },
    { input: [[7, 8], [7, 8], [7, 8]], expected: [[7, 8]] },
  ];
  for (const { input, expected } of cases) {
    assert.deepEqual(normalize(input), expected, JSON.stringify(input));
  }
});

test('normalize is idempotent and leaves its argument untouched', () => {
  const input = [[5, 7], [1, 2], [6, 9]];
  const snapshot = JSON.parse(JSON.stringify(input));
  const once = normalize(input);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(normalize(once), once);
  once[0][0] = 999;
  assert.deepEqual(input, snapshot);
});

test('normalize rejects malformed input with the specified error classes', () => {
  assert.throws(() => normalize('nope'), { name: 'TypeError', message: 'interval list must be an array' });
  assert.throws(() => normalize([[1]]), { name: 'TypeError', message: 'interval must be a two-element array' });
  assert.throws(() => normalize([[1, 2, 3]]), { name: 'TypeError', message: 'interval must be a two-element array' });
  assert.throws(() => normalize([[1.5, 2]]), { name: 'TypeError', message: 'interval bounds must be safe integers' });
  assert.throws(() => normalize([[1, Number.NaN]]), { name: 'TypeError', message: 'interval bounds must be safe integers' });
  assert.throws(() => normalize([[0, Number.POSITIVE_INFINITY]]), { name: 'TypeError', message: 'interval bounds must be safe integers' });
  assert.throws(() => normalize([['1', 2]]), { name: 'TypeError', message: 'interval bounds must be safe integers' });
  assert.throws(() => normalize([[9, 4]]), { name: 'RangeError', message: 'interval start must not exceed end' });
  assert.throws(() => merge([[0, 1]], [[3, 2]]), { name: 'RangeError', message: 'interval start must not exceed end' });
  assert.throws(() => intersect([[0, 1]], 7), { name: 'TypeError', message: 'interval list must be an array' });
  assert.throws(() => subtract([[0, 1]], [[]]), { name: 'TypeError', message: 'interval must be a two-element array' });
  assert.throws(() => coverage([[Number.MAX_SAFE_INTEGER + 1, 0]]), { name: 'TypeError', message: 'interval bounds must be safe integers' });
});

test('merge unions both lists', () => {
  assert.deepEqual(merge([], []), []);
  assert.deepEqual(merge([[1, 4]], []), [[1, 4]]);
  assert.deepEqual(merge([[1, 4]], [[4, 6]]), [[1, 6]]);
  assert.deepEqual(merge([[1, 4]], [[5, 6]]), [[1, 4], [5, 6]]);
  assert.deepEqual(merge([[10, 20], [0, 2]], [[2, 3], [19, 25]]), [[0, 3], [10, 25]]);
});

test('intersect keeps only shared points and never keeps touching endpoints', () => {
  assert.deepEqual(intersect([], [[0, 5]]), []);
  assert.deepEqual(intersect([[1, 3]], [[3, 5]]), []);
  assert.deepEqual(intersect([[1, 4]], [[3, 5]]), [[3, 4]]);
  assert.deepEqual(intersect([[0, 10]], [[2, 3], [4, 5]]), [[2, 3], [4, 5]]);
  assert.deepEqual(intersect([[0, 3], [4, 7]], [[2, 5]]), [[2, 3], [4, 5]]);
  assert.deepEqual(intersect([[-10, -2]], [[-5, 0]]), [[-5, -2]]);
  assert.deepEqual(intersect([[0, 6], [1, 2]], [[1, 9], [5, 5]]), [[1, 6]]);
});

test('subtract punches every hole and leaves the remainder normalised', () => {
  assert.deepEqual(subtract([[0, 10]], []), [[0, 10]]);
  assert.deepEqual(subtract([], [[0, 10]]), []);
  assert.deepEqual(subtract([[0, 10]], [[3, 5]]), [[0, 3], [5, 10]]);
  assert.deepEqual(subtract([[0, 10]], [[0, 10]]), []);
  assert.deepEqual(subtract([[0, 10]], [[-5, 20]]), []);
  assert.deepEqual(subtract([[0, 10]], [[10, 20]]), [[0, 10]]);
  assert.deepEqual(subtract([[0, 10]], [[0, 1], [9, 10]]), [[1, 9]]);
  assert.deepEqual(subtract([[0, 4], [6, 10]], [[2, 8]]), [[0, 2], [8, 10]]);
  assert.deepEqual(subtract([[0, 20]], [[1, 2], [4, 6], [7, 8]]), [[0, 1], [2, 4], [6, 7], [8, 20]]);
  assert.deepEqual(subtract([[-3, 3]], [[-1, 1]]), [[-3, -1], [1, 3]]);
});

test('coverage counts overlapping points once', () => {
  assert.equal(coverage([]), 0);
  assert.equal(coverage([[4, 4]]), 0);
  assert.equal(coverage([[0, 10], [2, 4]]), 10);
  assert.equal(coverage([[0, 3], [3, 6]]), 6);
  assert.equal(coverage([[-5, 5]]), 10);
});

test('operations agree with a rasterised model on adversarial random input', () => {
  const rnd = mulberry32(0xc0ffee);
  for (let round = 0; round < 300; round += 1) {
    const a = randomList(rnd, 1 + Math.floor(rnd() * 8));
    const b = randomList(rnd, 1 + Math.floor(rnd() * 8));
    const ra = raster(a);
    const rb = raster(b);
    const expectUnion = new Uint8Array(ra.length);
    const expectMeet = new Uint8Array(ra.length);
    const expectDiff = new Uint8Array(ra.length);
    for (let i = 0; i < ra.length; i += 1) {
      expectUnion[i] = ra[i] | rb[i];
      expectMeet[i] = ra[i] & rb[i];
      expectDiff[i] = ra[i] && !rb[i] ? 1 : 0;
    }
    const gotNorm = normalize(a);
    const gotUnion = merge(a, b);
    const gotMeet = intersect(a, b);
    const gotDiff = subtract(a, b);
    assertNormalised(gotNorm, `normalize round ${round}`);
    assertNormalised(gotUnion, `merge round ${round}`);
    assertNormalised(gotMeet, `intersect round ${round}`);
    assertNormalised(gotDiff, `subtract round ${round}`);
    assert.deepEqual(gotNorm, unraster(ra), `normalize round ${round}`);
    assert.deepEqual(gotUnion, unraster(expectUnion), `merge round ${round}`);
    assert.deepEqual(gotMeet, unraster(expectMeet), `intersect round ${round}`);
    assert.deepEqual(gotDiff, unraster(expectDiff), `subtract round ${round}`);
    assert.deepEqual(intersect(b, a), gotMeet, `intersect commutes round ${round}`);
    assert.equal(coverage(gotUnion), coverage(a) + coverage(b) - coverage(gotMeet), `inclusion-exclusion round ${round}`);
    assert.equal(coverage(gotDiff) + coverage(gotMeet), coverage(a), `partition round ${round}`);
    assert.deepEqual(intersect(gotDiff, b), [], `difference is disjoint from b round ${round}`);
  }
});

test('handles wide ranges and long lists without losing points', () => {
  const wide = [[-1000000, 1000000], [999999, 1000005]];
  assert.deepEqual(normalize(wide), [[-1000000, 1000005]]);
  assert.equal(coverage(wide), 2000005);
  const many = [];
  for (let i = 0; i < 500; i += 1) many.push([i * 3, i * 3 + 2]);
  assert.equal(normalize(many).length, 500);
  assert.equal(coverage(many), 1000);
  assert.deepEqual(subtract(many, [[0, 750]]), normalize(many).filter(([start]) => start >= 750));
  const alternating = [];
  for (let i = 0; i < 200; i += 1) alternating.push([-i, i + 1]);
  assert.deepEqual(normalize(alternating), [[-199, 200]]);
});
