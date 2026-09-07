import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RateLimiter } from '../src/limiter.js';

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
 * Builds a limiter driven by a hand-moved clock.
 * @param {object} options Limiter options without the clock.
 * @returns {{limiter: RateLimiter, advance: (ms: number) => void}} Harness.
 */
function harness(options) {
  let time = 0;
  const limiter = new RateLimiter({ ...options, clock: () => time });
  return { limiter, advance: (ms) => { time += ms; } };
}

test('a fresh bucket allows a burst up to its capacity and then denies', () => {
  const { limiter, advance } = harness({ capacity: 3, refillTokens: 1, refillIntervalMs: 100 });
  assert.deepEqual(
    [limiter.tryConsume('a'), limiter.tryConsume('a'), limiter.tryConsume('a'), limiter.tryConsume('a')],
    [
      { allowed: true, remaining: 2, retryAfterMs: 0 },
      { allowed: true, remaining: 1, retryAfterMs: 0 },
      { allowed: true, remaining: 0, retryAfterMs: 0 },
      { allowed: false, remaining: 0, retryAfterMs: 100 },
    ],
  );
  advance(100);
  assert.deepEqual(limiter.tryConsume('a'), { allowed: true, remaining: 0, retryAfterMs: 0 });
  assert.deepEqual([limiter.size, limiter.keys(), limiter.capacity], [1, ['a'], 3]);
  assert.deepEqual(limiter.stats(), { allowed: 4, denied: 1 });
});

test('a request may take exactly what is left', () => {
  const { limiter } = harness({ capacity: 3, refillTokens: 1, refillIntervalMs: 100 });
  assert.deepEqual(limiter.tryConsume('a', 3), { allowed: true, remaining: 0, retryAfterMs: 0 });
  const other = harness({ capacity: 4, refillTokens: 1, refillIntervalMs: 100 });
  other.limiter.tryConsume('b', 2);
  assert.deepEqual(other.limiter.tryConsume('b', 2), { allowed: true, remaining: 0, retryAfterMs: 0 });
});

test('time shorter than a whole interval still earns tokens', () => {
  const { limiter, advance } = harness({ capacity: 2, refillTokens: 1, refillIntervalMs: 100 });
  limiter.tryConsume('a', 2);
  advance(50);
  assert.equal(limiter.remaining('a'), 0);
  advance(50);
  assert.equal(limiter.remaining('a'), 1);
  assert.deepEqual(limiter.tryConsume('a'), { allowed: true, remaining: 0, retryAfterMs: 0 });
  const steady = harness({ capacity: 2, refillTokens: 1, refillIntervalMs: 64 });
  steady.limiter.tryConsume('b', 2);
  for (let i = 0; i < 8; i += 1) {
    steady.advance(8);
    steady.limiter.remaining('b');
  }
  assert.equal(steady.limiter.remaining('b'), 1);
});

test('the reported wait is exactly long enough', () => {
  const { limiter, advance } = harness({ capacity: 3, refillTokens: 3, refillIntervalMs: 100 });
  limiter.tryConsume('a', 3);
  const denied = limiter.tryConsume('a');
  assert.deepEqual([denied, limiter.waitFor('a')], [{ allowed: false, remaining: 0, retryAfterMs: 34 }, 34]);
  advance(33);
  assert.equal(limiter.tryConsume('a').allowed, false);
  advance(1);
  assert.equal(limiter.tryConsume('a').allowed, true);
  limiter.reset('a');
  limiter.tryConsume('a', 3);
  assert.equal(limiter.waitFor('a', 2), 67);
});

test('a request larger than the bucket can never be paid', () => {
  const { limiter, advance } = harness({ capacity: 3, refillTokens: 1, refillIntervalMs: 100 });
  assert.deepEqual(limiter.tryConsume('a', 4), { allowed: false, remaining: 3, retryAfterMs: null });
  assert.deepEqual([limiter.waitFor('a', 4), limiter.waitFor('fresh', 99)], [null, null]);
  advance(100000);
  assert.deepEqual(limiter.tryConsume('a', 4), { allowed: false, remaining: 3, retryAfterMs: null });
  assert.deepEqual(limiter.stats(), { allowed: 0, denied: 2 });
});

test('reset and clear give a key a full bucket again', () => {
  const { limiter } = harness({ capacity: 2, refillTokens: 1, refillIntervalMs: 100 });
  limiter.tryConsume('a', 2);
  assert.equal(limiter.tryConsume('a').allowed, false);
  assert.deepEqual([limiter.reset('a'), limiter.reset('a'), limiter.size], [true, false, 0]);
  assert.deepEqual(limiter.tryConsume('a'), { allowed: true, remaining: 1, retryAfterMs: 0 });
  assert.deepEqual([limiter.tryConsume('a').allowed, limiter.tryConsume('a').allowed], [true, false]);
  limiter.clear();
  assert.deepEqual([limiter.size, limiter.keys(), limiter.remaining('a')], [0, [], 2]);
  assert.deepEqual(limiter.tryConsume('a'), { allowed: true, remaining: 1, retryAfterMs: 0 });
});

test('buckets are independent per key', () => {
  const { limiter, advance } = harness({ capacity: 2, refillTokens: 1, refillIntervalMs: 100 });
  limiter.tryConsume('a', 2);
  assert.deepEqual([limiter.remaining('a'), limiter.remaining('b'), limiter.size], [0, 2, 1]);
  limiter.tryConsume('b');
  advance(100);
  assert.deepEqual([limiter.remaining('a'), limiter.remaining('b')], [1, 2]);
  assert.deepEqual(limiter.keys(), ['a', 'b']);
});

test('idle time never fills a bucket past its capacity', () => {
  const { limiter, advance } = harness({ capacity: 3, refillTokens: 1, refillIntervalMs: 100 });
  limiter.tryConsume('a');
  advance(1000000);
  assert.deepEqual(
    [limiter.remaining('a'), limiter.tryConsume('a', 3).allowed, limiter.tryConsume('a').allowed],
    [3, true, false],
  );
  advance(-5000);
  assert.equal(limiter.remaining('a'), 0);
});

test('consume reports refusal as an error carrying the wait', () => {
  const { limiter, advance } = harness({ capacity: 1, refillTokens: 1, refillIntervalMs: 200 });
  assert.equal(limiter.consume('a'), 0);
  assert.throws(() => limiter.consume('a'), (error) => {
    assert.equal(error.message, 'rate limit exceeded for "a"');
    assert.equal(error.retryAfterMs, 200);
    return true;
  });
  advance(200);
  assert.deepEqual([limiter.consume('a'), limiter.refund('a', 5), limiter.consume('a')], [0, 1, 0]);
});

test('a multi-key request takes everything or nothing', () => {
  const { limiter, advance } = harness({ capacity: 2, refillTokens: 1, refillIntervalMs: 100 });
  limiter.tryConsume('b', 2);
  assert.deepEqual(limiter.tryConsumeAll(['a', 'b']), { allowed: false, retryAfterMs: 100 });
  assert.deepEqual([limiter.remaining('a'), limiter.remaining('b')], [2, 0]);
  advance(100);
  assert.deepEqual(limiter.tryConsumeAll(['a', 'b']), { allowed: true, retryAfterMs: 0 });
  assert.deepEqual([limiter.remaining('a'), limiter.remaining('b')], [1, 0]);
  assert.deepEqual(limiter.tryConsumeAll(['a'], 5), { allowed: false, retryAfterMs: null });
  assert.throws(() => limiter.tryConsumeAll([]), { name: 'TypeError', message: 'keys must be a non-empty array of strings' });
});

test('snapshot describes every bucket and sweep retires the idle ones', () => {
  const { limiter, advance } = harness({ capacity: 2, refillTokens: 1, refillIntervalMs: 100 });
  limiter.tryConsume('a', 2);
  limiter.tryConsume('b');
  assert.deepEqual(limiter.snapshot(), [
    { key: 'a', remaining: 0, retryAfterMs: 100 },
    { key: 'b', remaining: 1, retryAfterMs: 0 },
  ]);
  assert.equal(limiter.sweep(50), 0);
  advance(100);
  assert.equal(limiter.sweep(100), 1);
  assert.deepEqual(limiter.keys(), ['a']);
  advance(100);
  assert.deepEqual([limiter.sweep(0), limiter.size, limiter.snapshot()], [1, 0, []]);
  assert.throws(() => limiter.sweep(-1), { name: 'TypeError', message: 'idleMs must be a non-negative integer' });
});

test('rejects malformed options and arguments', () => {
  const { limiter } = harness({ capacity: 2, refillTokens: 1, refillIntervalMs: 100 });
  const bad = [
    [() => new RateLimiter(), 'options must be an object'],
    [() => new RateLimiter({ capacity: 0, refillTokens: 1, refillIntervalMs: 1 }), 'capacity must be a positive integer'],
    [() => new RateLimiter({ capacity: 1.5, refillTokens: 1, refillIntervalMs: 1 }), 'capacity must be a positive integer'],
    [() => new RateLimiter({ capacity: 1, refillTokens: -1, refillIntervalMs: 1 }), 'refillTokens must be a positive integer'],
    [() => new RateLimiter({ capacity: 1, refillTokens: 1, refillIntervalMs: 0 }), 'refillIntervalMs must be a positive integer'],
    [() => new RateLimiter({ capacity: 1, refillTokens: 1, refillIntervalMs: 1, clock: 5 }), 'clock must be a function'],
    [() => limiter.tryConsume(7), 'key must be a string'],
    [() => limiter.remaining(null), 'key must be a string'],
    [() => limiter.tryConsume('a', 0), 'tokens must be a positive integer'],
    [() => limiter.tryConsume('a', 1.5), 'tokens must be a positive integer'],
    [() => limiter.waitFor('a', -2), 'tokens must be a positive integer'],
  ];
  for (const [call, message] of bad) assert.throws(call, { name: 'TypeError', message }, message);
});

test('matches an exact integer model over a long random sequence', () => {
  const rnd = mulberry32(0xb0cc);
  const capacity = 8;
  const refillTokens = 1;
  const interval = 64;
  let time = 0;
  const limiter = new RateLimiter({ capacity, refillTokens, refillIntervalMs: interval, clock: () => time });
  /** @type {Map<string, {scaled: number, updatedAt: number}>} */
  const model = new Map();
  const keys = ['a', 'b', 'c'];
  const full = capacity * interval;
  const refill = (bucket) => {
    const elapsed = time - bucket.updatedAt;
    if (elapsed <= 0) return bucket;
    bucket.scaled = Math.min(full, bucket.scaled + elapsed * refillTokens);
    bucket.updatedAt = time;
    return bucket;
  };
  const ensure = (key) => {
    if (!model.has(key)) model.set(key, { scaled: full, updatedAt: time });
    return refill(model.get(key));
  };
  let allowed = 0;
  let denied = 0;

  for (let step = 0; step < 3000; step += 1) {
    const key = keys[Math.floor(rnd() * keys.length)];
    const roll = rnd();
    if (roll < 0.55) {
      const tokens = 1 + Math.floor(rnd() * 10);
      const bucket = ensure(key);
      const need = tokens * interval;
      let expected;
      if (tokens > capacity) {
        expected = { allowed: false, remaining: Math.floor(bucket.scaled / interval), retryAfterMs: null };
        denied += 1;
      } else if (bucket.scaled >= need) {
        bucket.scaled -= need;
        expected = { allowed: true, remaining: Math.floor(bucket.scaled / interval), retryAfterMs: 0 };
        allowed += 1;
      } else {
        expected = { allowed: false, remaining: Math.floor(bucket.scaled / interval), retryAfterMs: need - bucket.scaled };
        denied += 1;
      }
      assert.deepEqual(limiter.tryConsume(key, tokens), expected, `consume ${key} x${tokens} at step ${step}`);
    } else if (roll < 0.7) {
      const bucket = model.get(key);
      const expected = bucket === undefined ? capacity : Math.floor(refill(bucket).scaled / interval);
      assert.equal(limiter.remaining(key), expected, `remaining ${key} at step ${step}`);
    } else if (roll < 0.8) {
      const tokens = 1 + Math.floor(rnd() * 4);
      const bucket = model.get(key);
      const scaled = bucket === undefined ? full : refill(bucket).scaled;
      const need = tokens * interval;
      const expected = tokens > capacity ? null : Math.max(0, need - scaled);
      assert.equal(limiter.waitFor(key, tokens), expected, `waitFor ${key} x${tokens} at step ${step}`);
    } else if (roll < 0.86) {
      const tokens = 1 + Math.floor(rnd() * 3);
      const bucket = ensure(key);
      bucket.scaled = Math.min(full, bucket.scaled + tokens * interval);
      assert.equal(limiter.refund(key, tokens), Math.floor(bucket.scaled / interval), `refund ${key} at step ${step}`);
    } else if (roll < 0.9) {
      assert.equal(limiter.reset(key), model.delete(key), `reset ${key} at step ${step}`);
    } else {
      time += 1 + Math.floor(rnd() * 200);
    }
    assert.deepEqual([limiter.size, limiter.keys()], [model.size, [...model.keys()]], `store at step ${step}`);
  }
  assert.deepEqual(limiter.stats(), { allowed, denied });
  assert.ok(allowed > 200 && denied > 200, `expected pressure in both directions, saw ${allowed}/${denied}`);
});
