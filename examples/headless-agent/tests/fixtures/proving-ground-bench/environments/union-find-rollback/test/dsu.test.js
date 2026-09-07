import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DisjointSets } from '../src/dsu.js';

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
 * Groups elements by their model label.
 * @param {number[]} labels One label per element.
 * @returns {number[][]} Sets, each ascending, ordered by smallest member.
 */
function groupsOf(labels) {
  const byLabel = new Map();
  labels.forEach((label, element) => {
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push(element);
  });
  return [...byLabel.values()].sort((a, b) => a[0] - b[0]);
}

test('a fresh structure holds singletons', () => {
  const sets = new DisjointSets(4);
  assert.deepEqual([sets.count, sets.components], [4, 4]);
  assert.deepEqual(sets.groups(), [[0], [1], [2], [3]]);
  assert.deepEqual([sets.find(2), sets.sizeOf(2), sets.connected(0, 1)], [2, 1, false]);
  assert.deepEqual([new DisjointSets(0).count, new DisjointSets(0).groups()], [0, []]);
  assert.equal(sets.undo(), false);
  assert.equal(sets.rollback(sets.checkpoint()), 0);
});

test('union joins by size and breaks ties with the smaller root', () => {
  const even = new DisjointSets(4);
  assert.equal(even.union(0, 1), true);
  assert.equal(even.union(1, 0), false);
  even.union(2, 3);
  assert.deepEqual([even.find(1), even.find(3), even.components], [0, 2, 2]);
  assert.equal(even.union(1, 3), true);
  assert.deepEqual([even.find(2), even.find(3), even.sizeOf(0), even.components], [0, 0, 4, 1]);
  const uneven = new DisjointSets(5);
  uneven.union(0, 1);
  uneven.union(2, 3);
  uneven.union(2, 4);
  assert.deepEqual([uneven.find(4), uneven.sizeOf(3)], [2, 3]);
  uneven.union(0, 4);
  assert.deepEqual([uneven.find(0), uneven.find(1), uneven.sizeOf(1), uneven.components], [2, 2, 5, 1]);
  assert.deepEqual(uneven.groups(), [[0, 1, 2, 3, 4]]);
});

test('undo reverses one union at a time', () => {
  const sets = new DisjointSets(4);
  sets.union(0, 1);
  sets.union(2, 3);
  sets.union(0, 2);
  assert.deepEqual([sets.components, sets.groups()], [1, [[0, 1, 2, 3]]]);
  assert.equal(sets.undo(), true);
  assert.deepEqual([sets.components, sets.groups(), sets.sizeOf(0), sets.find(3)], [2, [[0, 1], [2, 3]], 2, 2]);
  assert.equal(sets.undo(), true);
  assert.equal(sets.undo(), true);
  assert.deepEqual([sets.components, sets.groups(), sets.find(1)], [4, [[0], [1], [2], [3]], 1]);
  assert.equal(sets.undo(), false);
});

test('rollback returns to a checkpoint and refuses tokens it has passed', () => {
  const sets = new DisjointSets(6);
  sets.union(0, 1);
  const first = sets.checkpoint();
  sets.union(2, 3);
  const second = sets.checkpoint();
  sets.union(4, 5);
  sets.union(0, 2);
  assert.equal(sets.components, 2);
  assert.equal(sets.rollback(second), 2);
  assert.deepEqual([sets.components, sets.groups()], [4, [[0, 1], [2, 3], [4], [5]]]);
  assert.equal(sets.rollback(second), 0);
  assert.equal(sets.rollback(first), 1);
  assert.deepEqual([sets.components, sets.groups()], [5, [[0, 1], [2], [3], [4], [5]]]);
  assert.throws(() => sets.rollback(second), { name: 'RangeError', message: 'unknown checkpoint: 2' });
  assert.throws(() => sets.rollback(-1), { name: 'RangeError', message: 'unknown checkpoint: -1' });
  sets.union(3, 4);
  assert.deepEqual([sets.components, sets.rollback(0), sets.components], [4, 2, 6]);
});

test('rejects malformed counts and elements', () => {
  const sets = new DisjointSets(3);
  const bad = [
    [() => new DisjointSets(-1), 'TypeError', 'count must be a non-negative integer'],
    [() => new DisjointSets(2.5), 'TypeError', 'count must be a non-negative integer'],
    [() => new DisjointSets('3'), 'TypeError', 'count must be a non-negative integer'],
    [() => sets.find(3), 'RangeError', 'element out of range: 3'],
    [() => sets.find(-1), 'RangeError', 'element out of range: -1'],
    [() => sets.union(0, 9), 'RangeError', 'element out of range: 9'],
    [() => sets.sizeOf(1.5), 'RangeError', 'element out of range: 1.5'],
    [() => sets.connected(0, '1'), 'RangeError', 'element out of range: 1'],
    [() => sets.rollback(1.5), 'RangeError', 'unknown checkpoint: 1.5'],
  ];
  for (const [call, name, message] of bad) assert.throws(call, { name, message }, message);
});

test('matches a snapshot model across random unions, checkpoints, and rollbacks', () => {
  const rnd = mulberry32(0x0f5e7);
  const size = 12;
  const sets = new DisjointSets(size);
  let labels = Array.from({ length: size }, (_, index) => index);
  /** @type {number[][]} */
  const history = [labels.slice()];
  /** @type {number[]} */
  const marks = [];
  let unions = 0;
  const totals = { joined: 0, undone: 0 };

  for (let step = 0; step < 4000; step += 1) {
    const roll = rnd();
    if (roll < 0.5) {
      const a = Math.floor(rnd() * size);
      const b = Math.floor(rnd() * size);
      const joined = labels[a] !== labels[b];
      assert.equal(sets.union(a, b), joined, `union ${a},${b} at step ${step}`);
      if (joined) {
        const from = labels[b];
        const to = labels[a];
        labels = labels.map((label) => (label === from ? to : label));
        unions += 1;
        totals.joined += 1;
        history[unions] = labels.slice();
      }
    } else if (roll < 0.65) {
      const token = sets.checkpoint();
      assert.equal(token, unions, `checkpoint at step ${step}`);
      marks.push(token);
    } else if (roll < 0.8 && marks.length > 0) {
      const token = marks[Math.floor(rnd() * marks.length)];
      totals.undone += unions - token;
      assert.equal(sets.rollback(token), unions - token, `rollback to ${token} at step ${step}`);
      while (marks.length > 0 && marks[marks.length - 1] > token) marks.pop();
      unions = token;
      labels = history[unions].slice();
    } else if (roll < 0.9) {
      const undone = sets.undo();
      assert.equal(undone, unions > 0, `undo at step ${step}`);
      if (undone) {
        unions -= 1;
        labels = history[unions].slice();
        while (marks.length > 0 && marks[marks.length - 1] > unions) marks.pop();
      }
    } else {
      const a = Math.floor(rnd() * size);
      const b = Math.floor(rnd() * size);
      const same = labels[a] === labels[b];
      assert.deepEqual(
        [sets.connected(a, b), sets.find(a) === sets.find(b), sets.sizeOf(a)],
        [same, same, labels.filter((label) => label === labels[a]).length],
        `probe ${a},${b} at step ${step}`,
      );
    }
    const expected = groupsOf(labels);
    assert.deepEqual([sets.components, sets.groups()], [expected.length, expected], `state at step ${step}`);
    assert.ok(expected.find((group) => group.includes(0)).includes(sets.find(0)), `root of 0 at step ${step}`);
  }
  assert.ok(totals.joined > 200 && totals.undone > 100, `expected real history pressure, saw ${JSON.stringify(totals)}`);
});
