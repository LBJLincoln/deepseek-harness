import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IndexedHeap } from '../src/heap.js';

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

test('an empty heap reports nothing', () => {
  const heap = new IndexedHeap();
  assert.deepEqual([heap.size, heap.peek(), heap.pop(), heap.drain()], [0, undefined, undefined, []]);
  assert.deepEqual([heap.has('nope'), heap.priorityOf('nope'), heap.remove('nope')], [false, undefined, false]);
});

test('entries leave in priority order', () => {
  const heap = new IndexedHeap();
  for (const [key, priority] of [['e', 5], ['a', 1], ['d', 4], ['c', 3], ['b', 2]]) heap.push(key, priority);
  assert.equal(heap.size, 5);
  assert.deepEqual(heap.peek(), { key: 'a', priority: 1 });
  assert.deepEqual(heap.pop(), { key: 'a', priority: 1 });
  assert.deepEqual(heap.drain().map((entry) => entry.key), ['b', 'c', 'd', 'e']);
  assert.equal(heap.size, 0);
  const negatives = new IndexedHeap();
  for (const [key, priority] of [['zero', 0], ['neg', -3.5], ['pos', 0.5]]) negatives.push(key, priority);
  assert.deepEqual(negatives.drain(), [
    { key: 'neg', priority: -3.5 },
    { key: 'zero', priority: 0 },
    { key: 'pos', priority: 0.5 },
  ]);
});

test('equal priorities leave in insertion order', () => {
  const heap = new IndexedHeap();
  for (const key of ['p', 'q', 'r', 's', 't', 'u', 'v']) heap.push(key, 5);
  assert.deepEqual(heap.drain().map((entry) => entry.key), ['p', 'q', 'r', 's', 't', 'u', 'v']);
  const mixed = new IndexedHeap();
  for (const [key, priority] of [['a', 2], ['b', 1], ['c', 2], ['d', 1], ['e', 2]]) mixed.push(key, priority);
  assert.deepEqual(mixed.drain().map((entry) => entry.key), ['b', 'd', 'a', 'c', 'e']);
});

test('re-prioritising keeps the original insertion number', () => {
  const heap = new IndexedHeap();
  for (const key of ['x', 'y', 'z']) heap.push(key, 1);
  heap.setPriority('x', 9);
  assert.deepEqual(heap.peek(), { key: 'y', priority: 1 });
  heap.setPriority('x', 1);
  assert.deepEqual(heap.drain().map((entry) => entry.key), ['x', 'y', 'z']);
  const again = new IndexedHeap();
  for (const key of ['x', 'y', 'z']) again.push(key, 1);
  again.decreaseKey('z', 1);
  assert.deepEqual(again.drain().map((entry) => entry.key), ['x', 'y', 'z']);
});

test('decreaseKey lowers a priority and refuses to raise one', () => {
  const heap = new IndexedHeap();
  for (const [key, priority] of [['a', 10], ['b', 20], ['c', 30], ['d', 40]]) heap.push(key, priority);
  heap.decreaseKey('d', 5);
  assert.deepEqual(heap.peek(), { key: 'd', priority: 5 });
  assert.equal(heap.priorityOf('d'), 5);
  assert.throws(() => heap.decreaseKey('d', 6), { name: 'RangeError', message: 'priority must not increase for "d"' });
  assert.throws(() => heap.decreaseKey('gone', 1), { name: 'ReferenceError', message: 'unknown key: "gone"' });
  assert.throws(() => heap.setPriority('gone', 1), { name: 'ReferenceError', message: 'unknown key: "gone"' });
  heap.setPriority('a', 99);
  assert.deepEqual(heap.drain().map((entry) => entry.key), ['d', 'b', 'c', 'a']);
});

test('remove takes an entry from anywhere and keeps the order intact', () => {
  const heap = new IndexedHeap();
  for (const [key, priority] of [['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 5], ['f', 6], ['g', 7]]) {
    heap.push(key, priority);
  }
  assert.equal(heap.remove('a'), true);
  assert.equal(heap.remove('g'), true);
  assert.equal(heap.remove('d'), true);
  assert.equal(heap.remove('d'), false);
  assert.deepEqual([heap.size, heap.has('d'), heap.priorityOf('c')], [4, false, 3]);
  assert.deepEqual(heap.drain().map((entry) => entry.key), ['b', 'c', 'e', 'f']);
  const single = new IndexedHeap();
  single.push('only', 1);
  assert.equal(single.remove('only'), true);
  assert.deepEqual([single.size, single.peek()], [0, undefined]);
});

test('rejects malformed keys and priorities', () => {
  const heap = new IndexedHeap();
  heap.push('a', 1);
  const bad = [
    [() => heap.push('a', 2), 'Error', 'duplicate key: "a"'],
    [() => heap.push(1, 1), 'TypeError', 'key must be a string'],
    [() => heap.has(null), 'TypeError', 'key must be a string'],
    [() => heap.push('b', Number.NaN), 'TypeError', 'priority must be a finite number'],
    [() => heap.push('b', Number.POSITIVE_INFINITY), 'TypeError', 'priority must be a finite number'],
    [() => heap.push('b', '5'), 'TypeError', 'priority must be a finite number'],
    [() => heap.decreaseKey('a', Number.NaN), 'TypeError', 'priority must be a finite number'],
  ];
  for (const [call, name, message] of bad) assert.throws(call, { name, message }, message);
  assert.deepEqual([heap.size, heap.has('b')], [1, false]);
});

test('matches a naive model across a long random operation sequence', () => {
  const rnd = mulberry32(0x1e4d);
  const keyPool = Array.from({ length: 24 }, (_, i) => `k${String(i).padStart(2, '0')}`);
  const heap = new IndexedHeap();
  /** @type {Array<{key: string, priority: number, seq: number}>} */
  let model = [];
  let seq = 0;
  const best = () => {
    let winner = null;
    for (const item of model) {
      if (winner === null || item.priority < winner.priority || (item.priority === winner.priority && item.seq < winner.seq)) {
        winner = item;
      }
    }
    return winner;
  };

  for (let step = 0; step < 6000; step += 1) {
    const key = keyPool[Math.floor(rnd() * keyPool.length)];
    const held = model.find((item) => item.key === key);
    const roll = rnd();
    if (roll < 0.4) {
      const priority = Math.floor(rnd() * 8);
      if (held === undefined) {
        heap.push(key, priority);
        seq += 1;
        model.push({ key, priority, seq });
      } else {
        assert.throws(() => heap.push(key, priority), { name: 'Error', message: `duplicate key: "${key}"` }, `step ${step}`);
      }
    } else if (roll < 0.65) {
      const winner = best();
      const popped = heap.pop();
      if (winner === null) assert.equal(popped, undefined, `step ${step}`);
      else {
        assert.deepEqual(popped, { key: winner.key, priority: winner.priority }, `pop at step ${step}`);
        model = model.filter((item) => item !== winner);
      }
    } else if (roll < 0.8 && held !== undefined) {
      const priority = held.priority - Math.floor(rnd() * 4);
      heap.decreaseKey(key, priority);
      held.priority = priority;
    } else if (roll < 0.9 && held !== undefined) {
      const priority = Math.floor(rnd() * 12) - 2;
      heap.setPriority(key, priority);
      held.priority = priority;
    } else {
      assert.equal(heap.remove(key), held !== undefined, `remove at step ${step}`);
      model = model.filter((item) => item !== held);
    }
    assert.deepEqual([heap.size, heap.priorityOf(key)], [model.length, model.find((i) => i.key === key)?.priority], `state at step ${step}`);
  }

  const drained = heap.drain();
  const expected = [...model].sort((a, b) => a.priority - b.priority || a.seq - b.seq);
  assert.deepEqual(drained, expected.map(({ key, priority }) => ({ key, priority })));
  assert.deepEqual([heap.size, heap.pop()], [0, undefined]);
});
