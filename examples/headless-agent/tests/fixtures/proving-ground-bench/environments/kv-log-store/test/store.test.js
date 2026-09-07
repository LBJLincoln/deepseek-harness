import test from 'node:test';
import assert from 'node:assert/strict';
import { KvStore, decodeLog } from '../src/index.js';

/** Deterministic 32-bit PRNG so generated operation sequences replay identically. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fold decoded records into sorted entries, independently of the store. */
function fold(records) {
  const map = new Map();
  for (const record of records) {
    if (record.t === 'put') map.set(record.k, record.v);
    else map.delete(record.k);
  }
  return [...map.keys()].sort().map((key) => [key, map.get(key)]);
}

test('a fresh store is empty and readable', () => {
  const store = new KvStore();
  assert.equal(store.size, 0);
  assert.deepEqual(store.keys(), []);
  assert.deepEqual(store.entries(), []);
  assert.equal(store.get('missing'), undefined);
  assert.equal(store.has('missing'), false);
  assert.equal(store.log.length, 0);
  assert.deepEqual(store.stats(), { records: 0, liveKeys: 0, deadRecords: 0 });
});

test('put and delete maintain the live map', () => {
  const store = new KvStore();
  assert.equal(store.put('b', 2), store, 'put is chainable');
  store.put('a', 1).put('c', { nested: [true, null] });
  assert.deepEqual(store.keys(), ['a', 'b', 'c']);
  assert.equal(store.size, 3);
  assert.equal(store.get('a'), 1);
  assert.deepEqual(store.get('c'), { nested: [true, null] });
  assert.equal(store.has('b'), true);
  store.put('a', 'replaced');
  assert.equal(store.get('a'), 'replaced');
  assert.equal(store.size, 3);
  assert.equal(store.delete('b'), true);
  assert.equal(store.delete('b'), false);
  assert.equal(store.has('b'), false);
  assert.deepEqual(store.entries(), [['a', 'replaced'], ['c', { nested: [true, null] }]]);
});

test('deleting an absent key writes nothing to the log', () => {
  const store = new KvStore();
  store.put('a', 1);
  const before = store.log.length;
  const records = store.stats().records;
  assert.equal(store.delete('zzz'), false);
  assert.equal(store.log.length, before);
  assert.equal(store.stats().records, records);
  assert.equal(store.delete('a'), true);
  assert.equal(store.stats().records, records + 1);
  assert.equal(store.size, 0);
});

test('keys and values are validated', () => {
  const store = new KvStore();
  for (const key of ['', 7, null, undefined, {}]) {
    assert.throws(() => store.put(key, 1), { name: 'StoreError', code: 'BAD_KEY' }, `key ${String(key)}`);
  }
  assert.throws(() => store.get(''), { code: 'BAD_KEY', message: 'key must be a non-empty string' });
  assert.throws(() => store.delete(5), { code: 'BAD_KEY' });
  assert.throws(() => store.has(''), { code: 'BAD_KEY' });

  const circular = { self: null };
  circular.self = circular;
  const bad = [undefined, Number.NaN, Infinity, -Infinity, () => 1, new Date(0), new Map(), circular, { a: undefined }, [undefined]];
  for (const value of bad) {
    assert.throws(() => store.put('k', value), { code: 'BAD_VALUE', message: 'value is not serializable' });
  }
  for (const value of [0, -1.5, '', false, null, [], {}, { a: [1, { b: 'c' }] }]) {
    assert.equal(store.put('k', value), store, `accepts ${JSON.stringify(value) ?? 'value'}`);
  }
});

test('stored values do not alias caller values', () => {
  const store = new KvStore();
  const source = { a: [1, 2] };
  store.put('n', source);
  source.a.push(3);
  assert.deepEqual(store.get('n'), { a: [1, 2] });
  const taken = store.get('n');
  taken.a.push(9);
  assert.deepEqual(store.get('n'), { a: [1, 2] });
  const snapshot = store.snapshot();
  snapshot.entries[0][1].a.push(4);
  assert.deepEqual(store.get('n'), { a: [1, 2] });
});

test('the log getter hands out a copy', () => {
  const store = new KvStore();
  store.put('a', 1).put('b', 2);
  const before = Array.from(store.log);
  const scratch = store.log;
  scratch[0] ^= 0xff;
  assert.deepEqual(Array.from(store.log), before);
  assert.equal(decodeLog(store.log).records.length, 2);
});

test('replay reconstructs the store from its own log', () => {
  const store = new KvStore();
  store.put('a', 1).put('b', { x: [1, 2] }).put('a', 2);
  store.delete('b');
  store.put('日本', 'ok');
  const replayed = KvStore.replay(store.log);
  assert.deepEqual(replayed.entries(), store.entries());
  assert.deepEqual(replayed.log, store.log);
  assert.deepEqual(replayed.stats(), store.stats());
  const again = KvStore.replay(replayed.log);
  assert.deepEqual(again.log, store.log);
  assert.deepEqual(KvStore.replay(new Uint8Array(0)).entries(), []);
});

test('compaction keeps the state and removes every dead record', () => {
  const store = new KvStore();
  for (let index = 0; index < 50; index += 1) store.put(`k${index % 5}`, index);
  store.put('gone', 1);
  assert.equal(store.delete('gone'), true);
  assert.deepEqual(store.stats(), { records: 52, liveKeys: 5, deadRecords: 47 });

  const entries = store.entries();
  const bytesBefore = store.log.length;
  const result = store.compact();
  assert.equal(result.before, bytesBefore);
  assert.equal(result.after, store.log.length);
  assert.equal(result.reclaimed, result.before - result.after);
  assert.ok(result.reclaimed > 0, 'a log full of dead records shrinks');
  assert.deepEqual(store.entries(), entries);
  assert.deepEqual(store.stats(), { records: 5, liveKeys: 5, deadRecords: 0 });
  assert.deepEqual(decodeLog(store.log).records.map((record) => record.k), ['k0', 'k1', 'k2', 'k3', 'k4']);
  assert.deepEqual(KvStore.replay(store.log).entries(), entries);
  assert.equal(store.compact().reclaimed, 0, 'compacting twice reclaims nothing');
});

test('snapshots round-trip into a compact store', () => {
  const store = new KvStore();
  store.put('b', 2).put('a', { deep: [1, null] }).put('b', 'two');
  const snapshot = store.snapshot();
  assert.equal(snapshot.version, 1);
  assert.deepEqual(snapshot.entries, [['a', { deep: [1, null] }], ['b', 'two']]);
  const rebuilt = KvStore.fromSnapshot(snapshot);
  assert.deepEqual(rebuilt.entries(), store.entries());
  assert.deepEqual(rebuilt.stats(), { records: 2, liveKeys: 2, deadRecords: 0 });
  const compacted = KvStore.replay(store.log);
  compacted.compact();
  assert.deepEqual(rebuilt.log, compacted.log);
});

test('snapshot loading rejects malformed input', () => {
  assert.throws(() => KvStore.fromSnapshot(null), { code: 'BAD_SNAPSHOT', message: 'snapshot must be an object' });
  assert.throws(() => KvStore.fromSnapshot({ version: 2, entries: [] }), {
    code: 'BAD_SNAPSHOT',
    message: 'unsupported snapshot version',
  });
  assert.throws(() => KvStore.fromSnapshot({ version: 1 }), {
    code: 'BAD_SNAPSHOT',
    message: 'snapshot entries must be an array',
  });
  assert.throws(() => KvStore.fromSnapshot({ version: 1, entries: [['a']] }), {
    code: 'BAD_SNAPSHOT',
    message: 'each snapshot entry must be a key and a value',
  });
  assert.throws(() => KvStore.fromSnapshot({ version: 1, entries: [['', 1]] }), { code: 'BAD_KEY' });
  assert.throws(() => KvStore.fromSnapshot({ version: 1, entries: [['a', undefined]] }), { code: 'BAD_VALUE' });
  assert.throws(() => KvStore.fromSnapshot({ version: 1, entries: [['a', 1], ['a', 2]] }), {
    code: 'BAD_SNAPSHOT',
    message: 'duplicate key in snapshot: a',
  });
  assert.deepEqual(KvStore.fromSnapshot({ version: 1, entries: [] }).entries(), []);
});

test('a log cut at any byte replays to a valid earlier state', () => {
  const pick = mulberry32(13579);
  const keys = ['a', 'bb', 'ccc', 'd', 'ee'];
  const store = new KvStore();
  for (let step = 0; step < 80; step += 1) {
    const key = keys[Math.floor(pick() * keys.length)];
    if (pick() < 0.3) store.delete(key);
    else store.put(key, { step, tag: key.repeat(2) });
  }
  const full = store.log;
  const allRecords = decodeLog(full).records;
  assert.ok(full.length > 200, 'the generated log is substantial');
  let seen = 0;
  for (let cut = 0; cut <= full.length; cut += 1) {
    const piece = full.slice(0, cut);
    const decoded = decodeLog(piece);
    const replayed = KvStore.replay(piece);
    assert.deepEqual(decoded.records, allRecords.slice(0, decoded.records.length), `prefix at ${cut}`);
    assert.deepEqual(replayed.entries(), fold(decoded.records), `state at ${cut}`);
    assert.deepEqual(replayed.log, piece.slice(0, decoded.bytesUsed), `log at ${cut}`);
    assert.ok(decoded.records.length >= seen, `records never disappear at ${cut}`);
    seen = decoded.records.length;
  }
  assert.equal(seen, allRecords.length);
  assert.deepEqual(KvStore.replay(full).entries(), store.entries());
});

test('a long operation sequence stays consistent with its log', () => {
  const pick = mulberry32(24680);
  const store = new KvStore();
  const mirror = new Map();
  for (let step = 0; step < 2000; step += 1) {
    const key = `key${Math.floor(pick() * 40)}`;
    if (pick() < 0.25) {
      assert.equal(store.delete(key), mirror.delete(key), `delete agrees at ${step}`);
    } else {
      const value = pick() < 0.5 ? step : { step, list: [1, 2, 3] };
      store.put(key, value);
      mirror.set(key, value);
    }
  }
  assert.equal(store.size, mirror.size);
  assert.deepEqual(store.keys(), [...mirror.keys()].sort());
  assert.deepEqual(store.entries(), [...mirror.keys()].sort().map((key) => [key, mirror.get(key)]));
  assert.equal(store.stats().records, decodeLog(store.log).records.length);
  assert.deepEqual(KvStore.replay(store.log).entries(), store.entries());
  const reclaimed = store.compact().reclaimed;
  assert.ok(reclaimed > 0, 'a churned log compacts');
  assert.deepEqual(store.entries(), [...mirror.keys()].sort().map((key) => [key, mirror.get(key)]));
  assert.deepEqual(KvStore.replay(store.log).entries(), store.entries());
});
