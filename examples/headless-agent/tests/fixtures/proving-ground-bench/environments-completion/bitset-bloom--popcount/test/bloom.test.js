import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BloomFilter } from '../src/bloom.js';

/** Values used to exercise the probe arithmetic. */
const WORDS = [
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa',
  'lambda', 'mu', 'nu', 'xi', 'omicron', 'pi', 'rho', 'sigma', 'tau', 'upsilon',
  'key-a', 'key-b', 'key-c', 'user:1', 'user:2', 'user:3', '', '\u{1F600}', 'héllo', 'a'.repeat(64),
];

/**
 * Builds a filter holding every word.
 * @param {object} options Filter options.
 * @param {string[]} [values] Values to add.
 * @returns {BloomFilter} Populated filter.
 */
function populated(options, values = WORDS) {
  const filter = new BloomFilter(options);
  for (const value of values) filter.add(value);
  return filter;
}

test('every added value is reported as present', () => {
  const filter = populated({ bits: 512, hashes: 4 });
  for (const value of WORDS) assert.equal(filter.has(value), true, `has ${JSON.stringify(value)}`);
  assert.equal(filter.count, WORDS.length);
  assert.ok(filter.fillRatio() > 0 && filter.fillRatio() <= 1, `fill ratio ${filter.fillRatio()}`);
  const wide = populated({ bits: 4096, hashes: 7, seed: 12345 });
  for (const value of WORDS) assert.equal(wide.has(value), true, `wide has ${JSON.stringify(value)}`);
  const tight = populated({ bits: 37, hashes: 3, seed: 0xffffffff });
  for (const value of WORDS) assert.equal(tight.has(value), true, `tight has ${JSON.stringify(value)}`);
});

test('an empty filter reports nothing and misses are usually detected', () => {
  const empty = new BloomFilter({ bits: 1024, hashes: 5 });
  for (const value of WORDS) assert.equal(empty.has(value), false, `empty has ${JSON.stringify(value)}`);
  assert.deepEqual([empty.count, empty.fillRatio()], [0, 0]);
  const filter = populated({ bits: 4096, hashes: 6 });
  const absent = Array.from({ length: 200 }, (_, index) => `missing-${index}`);
  const positives = absent.filter((value) => filter.has(value));
  assert.ok(positives.length < 5, `too many false positives: ${positives.length}`);
});

test('the same values and seed produce the same bits', () => {
  const first = populated({ bits: 256, hashes: 3, seed: 7 });
  const second = populated({ bits: 256, hashes: 3, seed: 7 }, [...WORDS].reverse());
  assert.deepEqual([...first.serialize()], [...second.serialize()]);
  const seeded = populated({ bits: 256, hashes: 3, seed: 8 });
  assert.notDeepEqual([...seeded.serialize()], [...first.serialize()]);
  assert.deepEqual([first.bits, first.hashes, first.seed], [256, 3, 7]);
});

test('union merges filters built the same way and refuses the rest', () => {
  const left = populated({ bits: 512, hashes: 4, seed: 3 }, WORDS.slice(0, 10));
  const right = populated({ bits: 512, hashes: 4, seed: 3 }, WORDS.slice(10, 20));
  const merged = left.union(right);
  for (const value of WORDS.slice(0, 20)) assert.equal(merged.has(value), true, `merged has ${value}`);
  assert.deepEqual([merged.count, merged.bits, merged.hashes, merged.seed], [20, 512, 4, 3]);
  assert.equal(left.count, 10);
  const bad = [
    [() => left.union(new BloomFilter({ bits: 256, hashes: 4, seed: 3 })), 'RangeError'],
    [() => left.union(new BloomFilter({ bits: 512, hashes: 5, seed: 3 })), 'RangeError'],
    [() => left.union(new BloomFilter({ bits: 512, hashes: 4, seed: 4 })), 'RangeError'],
  ];
  for (const [call, name] of bad) {
    assert.throws(call, { name, message: 'bloom filters must share their parameters' });
  }
  assert.throws(() => left.union({}), { name: 'TypeError', message: 'argument must be a BloomFilter' });
});

test('a serialized filter round-trips through bytes', () => {
  const filter = populated({ bits: 512, hashes: 4, seed: 0 });
  const bytes = filter.serialize();
  assert.deepEqual([...bytes.slice(0, 17)], [66, 76, 77, 49, 0, 2, 0, 0, 0, 0, 0, 0, 4, 30, 0, 0, 0]);
  assert.equal(bytes.length, 17 + 64);
  const restored = BloomFilter.deserialize(bytes);
  assert.deepEqual([restored.bits, restored.hashes, restored.seed, restored.count], [512, 4, 0, WORDS.length]);
  for (const value of WORDS) assert.equal(restored.has(value), true, `restored has ${JSON.stringify(value)}`);
  assert.deepEqual([...restored.serialize()], [...bytes]);
  const odd = populated({ bits: 100, hashes: 3, seed: 9 });
  const oddBytes = odd.serialize();
  assert.equal(oddBytes.length, 17 + 13);
  const oddBack = BloomFilter.deserialize(oddBytes);
  for (const value of WORDS) assert.equal(oddBack.has(value), true, `odd restored has ${JSON.stringify(value)}`);
});

test('malformed options and payloads are refused', () => {
  const bytes = populated({ bits: 512, hashes: 4 }).serialize();
  const bad = [
    [() => new BloomFilter(), 'TypeError', 'options must be an object'],
    [() => new BloomFilter({ bits: 0, hashes: 1 }), 'TypeError', 'bits must be a positive integer'],
    [() => new BloomFilter({ bits: 8, hashes: 0 }), 'TypeError', 'hashes must be a positive integer'],
    [() => new BloomFilter({ bits: 8, hashes: 1, seed: -1 }), 'TypeError', 'seed must be a 32-bit unsigned integer'],
    [() => new BloomFilter({ bits: 8, hashes: 1, seed: 2 ** 32 }), 'TypeError', 'seed must be a 32-bit unsigned integer'],
    [() => new BloomFilter({ bits: 8, hashes: 1 }).add(7), 'TypeError', 'value must be a string'],
    [() => new BloomFilter({ bits: 8, hashes: 1 }).has(null), 'TypeError', 'value must be a string'],
    [() => BloomFilter.deserialize([...bytes]), 'TypeError', 'bytes must be a Uint8Array'],
    [() => BloomFilter.deserialize(new Uint8Array(4)), 'Error', 'unrecognised bloom filter header'],
    [() => BloomFilter.deserialize(bytes.slice(0, 40)), 'RangeError', 'serialized length does not match the header'],
  ];
  for (const [call, name, message] of bad) assert.throws(call, { name, message }, message);
});
