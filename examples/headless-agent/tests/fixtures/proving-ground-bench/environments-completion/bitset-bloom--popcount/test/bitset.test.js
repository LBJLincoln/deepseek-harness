import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BitSet } from '../src/bitset.js';

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

test('bits can be set, read, cleared, and flipped', () => {
  const set = new BitSet(64);
  assert.deepEqual([set.size, set.count(), set.get(0)], [64, 0, false]);
  set.set(0).set(7).set(63);
  assert.deepEqual([set.get(0), set.get(7), set.get(63), set.get(8), set.count()], [true, true, true, false, 3]);
  set.set(7);
  assert.equal(set.count(), 3);
  set.clear(7);
  assert.deepEqual([set.get(7), set.count()], [false, 2]);
  set.toggle(7).toggle(0);
  assert.deepEqual([set.get(7), set.get(0), set.count()], [true, false, 2]);
});

test('the highest bit of a word counts like any other', () => {
  const one = new BitSet(32).set(31);
  assert.deepEqual([one.count(), one.get(31)], [1, true]);
  const two = new BitSet(64).set(31).set(63);
  assert.equal(two.count(), 2);
  const full = new BitSet(32);
  for (let index = 0; index < 32; index += 1) full.set(index);
  assert.equal(full.count(), 32);
  const wide = new BitSet(96);
  for (let index = 0; index < 96; index += 1) wide.set(index);
  assert.equal(wide.count(), 96);
});

test('a size that is not a multiple of the word width still holds its last bits', () => {
  const set = new BitSet(100);
  set.set(96).set(99).set(0);
  assert.deepEqual([set.get(96), set.get(99), set.count()], [true, true, 3]);
  assert.equal(set.toBytes().length, 13);
  assert.ok(BitSet.fromBytes(set.toBytes(), 100).equals(set));
  const odd = new BitSet(33).set(32);
  assert.deepEqual([odd.count(), odd.get(32), odd.toBytes().length], [1, true, 5]);
});

test('indexes outside the set are refused', () => {
  const set = new BitSet(100);
  const bad = [
    [() => new BitSet(0), 'TypeError', 'size must be a positive integer'],
    [() => new BitSet(-8), 'TypeError', 'size must be a positive integer'],
    [() => new BitSet(1.5), 'TypeError', 'size must be a positive integer'],
    [() => set.set(100), 'RangeError', 'bit index out of range: 100'],
    [() => set.get(100), 'RangeError', 'bit index out of range: 100'],
    [() => set.clear(-1), 'RangeError', 'bit index out of range: -1'],
    [() => set.toggle(1.5), 'RangeError', 'bit index out of range: 1.5'],
    [() => set.or(new BitSet(101)), 'RangeError', 'bit sets must have the same size'],
    [() => set.and(new BitSet(99)), 'RangeError', 'bit sets must have the same size'],
    [() => new BitSet(33).or(new BitSet(40)), 'RangeError', 'bit sets must have the same size'],
    [() => set.or([]), 'TypeError', 'argument must be a BitSet'],
  ];
  for (const [call, name, message] of bad) assert.throws(call, { name, message }, message);
  assert.equal(set.count(), 0);
});

test('union and intersection combine two sets of the same size', () => {
  const left = new BitSet(70).set(1).set(35).set(69);
  const right = new BitSet(70).set(35).set(64);
  const union = left.or(right);
  const meet = left.and(right);
  assert.deepEqual([union.count(), union.get(1), union.get(64), union.size], [4, true, true, 70]);
  assert.deepEqual([meet.count(), meet.get(35), meet.get(1)], [1, true, false]);
  assert.deepEqual([left.count(), right.count()], [3, 2]);
  assert.equal(left.equals(new BitSet(70).set(1).set(35).set(69)), true);
  assert.equal(left.equals(right), false);
  assert.equal(left.equals(new BitSet(71).set(1).set(35).set(69)), false);
});

test('bytes carry the low bit of each byte first', () => {
  const set = new BitSet(12).set(0).set(3).set(11);
  assert.deepEqual([...set.toBytes()], [9, 8]);
  assert.ok(BitSet.fromBytes(new Uint8Array([9, 8]), 12).equals(set));
  assert.deepEqual([...new BitSet(8).set(7).toBytes()], [128]);
  const bad = [
    [() => BitSet.fromBytes([9, 8], 12), 'TypeError', 'bytes must be a Uint8Array'],
    [() => BitSet.fromBytes(new Uint8Array([9]), 12), 'RangeError', 'byte length does not match bit size'],
    [() => BitSet.fromBytes(new Uint8Array([9, 8, 0]), 12), 'RangeError', 'byte length does not match bit size'],
    [() => BitSet.fromBytes(new Uint8Array([0, 0x80]), 12), 'RangeError', 'bytes hold bits beyond the set size'],
  ];
  for (const [call, name, message] of bad) assert.throws(call, { name, message }, message);
});

test('matches a boolean array over a long random operation sequence', () => {
  const rnd = mulberry32(0xb175e7);
  const size = 205;
  const set = new BitSet(size);
  const model = new Array(size).fill(false);
  for (let step = 0; step < 4000; step += 1) {
    const index = Math.floor(rnd() * size);
    const roll = rnd();
    if (roll < 0.4) {
      set.set(index);
      model[index] = true;
    } else if (roll < 0.6) {
      set.clear(index);
      model[index] = false;
    } else if (roll < 0.75) {
      set.toggle(index);
      model[index] = !model[index];
    } else {
      assert.equal(set.get(index), model[index], `get ${index} at step ${step}`);
    }
    if (step % 50 === 0) {
      assert.equal(set.count(), model.filter(Boolean).length, `count at step ${step}`);
      const copy = BitSet.fromBytes(set.toBytes(), size);
      assert.ok(copy.equals(set), `round trip at step ${step}`);
      const other = new BitSet(size);
      const otherModel = new Array(size).fill(false);
      for (let i = 0; i < size; i += 1) {
        if (rnd() < 0.3) {
          other.set(i);
          otherModel[i] = true;
        }
      }
      const union = set.or(other);
      const meet = set.and(other);
      assert.equal(union.count(), model.filter((bit, i) => bit || otherModel[i]).length, `union at step ${step}`);
      assert.equal(meet.count(), model.filter((bit, i) => bit && otherModel[i]).length, `meet at step ${step}`);
    }
  }
  assert.ok(set.count() > 20, `expected a populated set, saw ${set.count()}`);
});
