import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LruTtlCache } from '../src/cache.js';

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
 * Builds a cache with a hand-driven clock and an eviction log.
 * @param {object} options Cache options without the clock.
 * @returns {{cache: LruTtlCache, log: Array<[string, unknown, string]>, advance: (ms: number) => void}} Harness.
 */
function harness(options) {
  let time = 0;
  const log = [];
  const cache = new LruTtlCache({
    ...options,
    clock: () => time,
    onEvict: (key, value, reason) => log.push([key, value, reason]),
  });
  return { cache, log, advance: (ms) => { time += ms; } };
}

test('evicts the least recently used entry when the byte budget is exceeded', () => {
  const { cache, log } = harness({ maxBytes: 3 });
  assert.equal(cache.set('a', 1), true);
  cache.set('b', 2);
  cache.set('c', 3);
  assert.deepEqual(cache.keys(), ['a', 'b', 'c']);
  assert.equal(cache.get('a'), 1);
  assert.deepEqual(cache.keys(), ['b', 'c', 'a']);
  cache.set('d', 4);
  assert.deepEqual(cache.keys(), ['c', 'a', 'd']);
  assert.deepEqual(log, [['b', 2, 'size']]);
  assert.deepEqual([cache.size, cache.bytes, cache.capacity], [3, 3, 3]);
});

test('charges the sizer and evicts until the total fits', () => {
  const { cache, log } = harness({ maxBytes: 10, sizeOf: (value) => value.length });
  cache.set('x', '12345');
  cache.set('y', '12345');
  cache.set('z', '1');
  assert.deepEqual([cache.keys(), cache.bytes], [['y', 'z'], 6]);
  assert.deepEqual(log, [['x', '12345', 'size']]);
  cache.set('big', '0123456789');
  assert.deepEqual([cache.keys(), cache.bytes], [['big'], 10]);
  assert.equal(cache.set('huge', '0123456789A'), false);
  assert.deepEqual(cache.keys(), ['big']);
  assert.equal(cache.set('big', '0123456789A'), false);
  assert.deepEqual([cache.keys(), cache.bytes], [[], 0]);
  assert.deepEqual(log.slice(-1), [['big', '0123456789', 'replace']]);
});

test('an entry expires once its lifetime has fully elapsed', () => {
  const { cache, log, advance } = harness({ maxBytes: 8, ttlMs: 100 });
  cache.set('k', 'v');
  advance(99);
  assert.deepEqual([cache.has('k'), cache.peek('k'), cache.get('k')], [true, 'v', 'v']);
  advance(1);
  assert.equal(cache.has('k'), false);
  assert.deepEqual(log, [['k', 'v', 'expire']]);
  assert.equal(cache.size, 0);
  assert.equal(cache.get('k'), undefined);
  assert.deepEqual(cache.stats(), { hits: 1, misses: 1, evictions: 0, expirations: 1 });
});

test('reading refreshes recency but never the lifetime', () => {
  const { cache, advance } = harness({ maxBytes: 8, ttlMs: 100 });
  cache.set('k', 'v');
  advance(50);
  assert.equal(cache.get('k'), 'v');
  advance(50);
  assert.equal(cache.get('k'), undefined);
  cache.set('slow', 1, { ttlMs: 400 });
  cache.set('fast', 2, { ttlMs: 10 });
  advance(11);
  assert.deepEqual(cache.keys(), ['slow']);
  advance(400);
  assert.deepEqual([cache.prune(), cache.prune()], [1, 0]);
  assert.equal(cache.set('forever', 3, { ttlMs: Number.POSITIVE_INFINITY }), true);
  advance(1e9);
  assert.equal(cache.get('forever'), 3);
});

test('peek and has leave recency untouched', () => {
  const { cache } = harness({ maxBytes: 3 });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  assert.deepEqual([cache.peek('a'), cache.has('a'), cache.peek('gone')], [1, true, undefined]);
  assert.deepEqual(cache.keys(), ['a', 'b', 'c']);
  cache.set('d', 4);
  assert.deepEqual(cache.keys(), ['b', 'c', 'd']);
  assert.deepEqual(cache.stats(), { hits: 0, misses: 0, evictions: 1, expirations: 0 });
});

test('replacing a key reports the old value and restarts its lifetime', () => {
  const { cache, log, advance } = harness({ maxBytes: 20, ttlMs: 100, sizeOf: (value) => value.length });
  cache.set('k', 'aaaa');
  advance(80);
  cache.set('k', 'bb');
  assert.deepEqual(log, [['k', 'aaaa', 'replace']]);
  assert.equal(cache.bytes, 2);
  advance(80);
  assert.equal(cache.get('k'), 'bb');
  assert.deepEqual(cache.stats(), { hits: 1, misses: 0, evictions: 0, expirations: 0 });
});

test('an expired victim is reported as expired even when the budget forced the removal', () => {
  const { cache, log, advance } = harness({ maxBytes: 2, ttlMs: 50 });
  cache.set('old', 1);
  advance(60);
  cache.set('mid', 2);
  cache.set('new', 3);
  assert.deepEqual(log, [['old', 1, 'expire']]);
  assert.deepEqual(cache.keys(), ['mid', 'new']);
  assert.deepEqual(cache.stats(), { hits: 0, misses: 0, evictions: 0, expirations: 1 });
});

test('delete and clear remove entries silently', () => {
  const { cache, log } = harness({ maxBytes: 5 });
  cache.set('a', 1);
  cache.set('b', 2);
  assert.deepEqual([cache.delete('a'), cache.delete('a')], [true, false]);
  assert.deepEqual([cache.size, cache.bytes], [1, 1]);
  cache.clear();
  assert.deepEqual([cache.size, cache.bytes, cache.keys()], [0, 0, []]);
  assert.deepEqual(log, []);
  cache.set('c', 3);
  assert.deepEqual(cache.keys(), ['c']);
});

test('rejects malformed options and keys', () => {
  const badOptions = [
    [undefined, 'options must be an object'],
    [{ maxBytes: 0 }, 'maxBytes must be a positive integer'],
    [{ maxBytes: 1.5 }, 'maxBytes must be a positive integer'],
    [{ maxBytes: Number.POSITIVE_INFINITY }, 'maxBytes must be a positive integer'],
    [{ maxBytes: 4, ttlMs: -1 }, 'ttlMs must be a non-negative number'],
    [{ maxBytes: 4, ttlMs: '10' }, 'ttlMs must be a non-negative number'],
    [{ maxBytes: 4, clock: 0 }, 'clock must be a function'],
    [{ maxBytes: 4, sizeOf: 8 }, 'sizeOf must be a function'],
    [{ maxBytes: 4, onEvict: 'no' }, 'onEvict must be a function'],
  ];
  for (const [options, message] of badOptions) {
    assert.throws(() => new LruTtlCache(options), { name: 'TypeError', message }, JSON.stringify(options ?? null));
  }
  const { cache } = harness({ maxBytes: 4, sizeOf: (value) => value });
  const badCalls = [
    [() => cache.set(7, 1), 'key must be a string'],
    [() => cache.get(null), 'key must be a string'],
    [() => cache.has(Symbol.iterator), 'key must be a string'],
    [() => cache.set('k', 2.5), 'sizeOf must return a non-negative safe integer'],
    [() => cache.set('k', -1), 'sizeOf must return a non-negative safe integer'],
    [() => cache.set('k', 1, { ttlMs: -5 }), 'ttlMs must be a non-negative number'],
    [() => cache.set('k', 1, null), 'options must be an object'],
  ];
  for (const [call, message] of badCalls) {
    assert.throws(call, { name: 'TypeError', message }, message);
  }
});

test('a zero lifetime expires immediately', () => {
  const { cache, log } = harness({ maxBytes: 4, ttlMs: 0 });
  assert.deepEqual([cache.set('k', 'v'), cache.size], [true, 1]);
  assert.equal(cache.get('k'), undefined);
  assert.deepEqual(log, [['k', 'v', 'expire']]);
  assert.deepEqual(cache.keys(), []);
});

test('holds every invariant across a long random operation sequence', () => {
  const rnd = mulberry32(0xca11ab1e);
  const keyPool = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const sizeOf = (value) => (value % 4) + 1;
  let time = 0;
  const log = [];
  const cache = new LruTtlCache({
    maxBytes: 12,
    ttlMs: 90,
    clock: () => time,
    sizeOf,
    onEvict: (key, value, reason) => log.push([key, value, reason]),
  });

  /** @type {Array<{key: string, value: number, bytes: number, storedAt: number, ttlMs: number}>} */
  let model = [];
  const modelLog = [];
  const counters = { hits: 0, misses: 0, evictions: 0, expirations: 0 };
  let modelBytes = 0;
  const expired = (entry) => time - entry.storedAt >= entry.ttlMs;
  const drop = (entry, reason) => {
    model = model.filter((other) => other !== entry);
    modelBytes -= entry.bytes;
    if (reason === 'expire') counters.expirations += 1;
    if (reason === 'size') counters.evictions += 1;
    modelLog.push([entry.key, entry.value, reason]);
  };
  const find = (key) => model.find((entry) => entry.key === key);

  for (let step = 0; step < 4000; step += 1) {
    const key = keyPool[Math.floor(rnd() * keyPool.length)];
    const roll = rnd();
    if (roll < 0.42) {
      const value = Math.floor(rnd() * 20);
      const ttlMs = rnd() < 0.25 ? Math.floor(rnd() * 60) : 90;
      cache.set(key, value, { ttlMs });
      const bytes = sizeOf(value);
      const existing = find(key);
      if (existing !== undefined) drop(existing, 'replace');
      model.push({ key, value, bytes, storedAt: time, ttlMs });
      modelBytes += bytes;
      while (modelBytes > 12) drop(model[0], expired(model[0]) ? 'expire' : 'size');
    } else if (roll < 0.72) {
      const entry = find(key);
      let expect;
      if (entry === undefined) {
        counters.misses += 1;
      } else if (expired(entry)) {
        drop(entry, 'expire');
        counters.misses += 1;
      } else {
        model = model.filter((other) => other !== entry).concat(entry);
        counters.hits += 1;
        expect = entry.value;
      }
      assert.equal(cache.get(key), expect, `get ${key} at step ${step}`);
    } else if (roll < 0.8) {
      const entry = find(key);
      const live = entry !== undefined && !expired(entry);
      if (entry !== undefined && !live) drop(entry, 'expire');
      assert.equal(cache.has(key), live, `has ${key} at step ${step}`);
    } else if (roll < 0.86) {
      const entry = find(key);
      if (entry !== undefined) {
        model = model.filter((other) => other !== entry);
        modelBytes -= entry.bytes;
      }
      assert.equal(cache.delete(key), entry !== undefined, `delete ${key} at step ${step}`);
    } else if (roll < 0.92) {
      for (const entry of [...model]) {
        if (expired(entry)) drop(entry, 'expire');
      }
      assert.deepEqual(cache.keys(), model.map((entry) => entry.key), `keys at step ${step}`);
    } else {
      time += 1 + Math.floor(rnd() * 40);
    }
    assert.deepEqual([cache.size, cache.bytes], [model.length, modelBytes], `store at step ${step}`);
  }

  assert.deepEqual(cache.stats(), counters);
  assert.deepEqual(log, modelLog);
  assert.ok(counters.evictions > 50 && counters.expirations > 50, `pressure ${JSON.stringify(counters)}`);
});
