import test from 'node:test';
import assert from 'node:assert/strict';
import { HEADER_BYTES, crc32, decodeLog, encodeRecord, isRecord } from '../src/index.js';

/** Deterministic 32-bit PRNG so generated logs replay identically. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const utf8 = (text) => new TextEncoder().encode(text);

/** Concatenate framed records into one log. */
function buildLog(records) {
  const frames = records.map((record) => encodeRecord(record));
  const total = frames.reduce((sum, frame) => sum + frame.length, 0);
  const log = new Uint8Array(total);
  let offset = 0;
  for (const frame of frames) {
    log.set(frame, offset);
    offset += frame.length;
  }
  return log;
}

test('crc32 matches the standard vectors', () => {
  assert.equal(HEADER_BYTES, 8);
  assert.equal(crc32(new Uint8Array(0)), 0);
  assert.equal(crc32(utf8('a')), 0xe8b7be43);
  assert.equal(crc32(utf8('123456789')), 0xcbf43926);
  assert.equal(crc32(utf8('The quick brown fox jumps over the lazy dog')), 0x414fa339);
  assert.equal(crc32(new Uint8Array([0, 0, 0, 0])), 0x2144df1c);
  assert.ok(crc32(utf8('abc')) >= 0, 'checksums are unsigned');
  assert.throws(() => crc32([1, 2, 3]), { name: 'StoreError', code: 'BAD_INPUT' });
});

test('isRecord accepts only applicable records', () => {
  const cases = [
    [{ t: 'put', k: 'a', v: 1 }, true],
    [{ t: 'put', k: 'a', v: null }, true],
    [{ t: 'del', k: 'a' }, true],
    [{ t: 'put', k: 'a' }, false],
    [{ t: 'put', k: '', v: 1 }, false],
    [{ t: 'del', k: '' }, false],
    [{ t: 'set', k: 'a', v: 1 }, false],
    [{ k: 'a', v: 1 }, false],
    [null, false],
    [['put', 'a', 1], false],
    ['put a 1', false],
  ];
  for (const [record, expected] of cases) {
    assert.equal(isRecord(record), expected, `isRecord(${JSON.stringify(record)})`);
  }
});

test('encodeRecord writes a length and checksum header', () => {
  const record = { t: 'put', k: 'alpha', v: { n: 1 } };
  const frame = encodeRecord(record);
  const payload = frame.subarray(HEADER_BYTES);
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  assert.equal(view.getUint32(0, false), payload.length);
  assert.equal(view.getUint32(4, false), crc32(payload));
  assert.equal(frame.length, HEADER_BYTES + payload.length);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(payload)), record);
  assert.equal(encodeRecord({ t: 'del', k: 'alpha' }).length < frame.length, true);
});

test('encodeRecord rejects records that cannot be applied', () => {
  assert.throws(() => encodeRecord({ t: 'put', k: 'a' }), { code: 'BAD_RECORD' });
  assert.throws(() => encodeRecord({ t: 'nope', k: 'a', v: 1 }), { code: 'BAD_RECORD' });
  assert.throws(() => encodeRecord({ t: 'put', k: '', v: 1 }), { code: 'BAD_RECORD' });
  assert.throws(() => encodeRecord(null), { code: 'BAD_RECORD' });
});

test('decodeLog round-trips a whole log', () => {
  const records = [
    { t: 'put', k: 'a', v: 1 },
    { t: 'put', k: 'b', v: { deep: [1, 'two', null] } },
    { t: 'del', k: 'a' },
    { t: 'put', k: '日本', v: 'ünïcodé' },
  ];
  const log = buildLog(records);
  const decoded = decodeLog(log);
  assert.deepEqual(decoded.records, records);
  assert.equal(decoded.bytesUsed, log.length);
  assert.equal(decoded.truncated, false);
  assert.deepEqual(decodeLog(new Uint8Array(0)), { records: [], bytesUsed: 0, truncated: false });
  assert.throws(() => decodeLog('not bytes'), { code: 'BAD_INPUT', message: 'bytes must be a Uint8Array' });
});

test('decoding stops cleanly at every truncation point', () => {
  const records = [
    { t: 'put', k: 'a', v: 'first' },
    { t: 'put', k: 'bb', v: [1, 2, 3] },
    { t: 'del', k: 'a' },
    { t: 'put', k: 'c', v: true },
  ];
  const log = buildLog(records);
  const boundaries = new Set([0]);
  let running = 0;
  for (const record of records) {
    running += encodeRecord(record).length;
    boundaries.add(running);
  }
  let previous = 0;
  for (let cut = 0; cut <= log.length; cut += 1) {
    const decoded = decodeLog(log.slice(0, cut));
    assert.deepEqual(decoded.records, records.slice(0, decoded.records.length), `prefix at ${cut}`);
    assert.ok(decoded.records.length >= previous, `record count never falls at ${cut}`);
    assert.ok(decoded.bytesUsed <= cut, `never consumes past the cut at ${cut}`);
    assert.equal(decoded.truncated, !boundaries.has(cut), `truncation flag at ${cut}`);
    previous = decoded.records.length;
  }
  assert.equal(previous, records.length);
});

test('a corrupted frame ends the scan without throwing', () => {
  const records = [
    { t: 'put', k: 'a', v: 'one' },
    { t: 'put', k: 'b', v: 'two' },
    { t: 'put', k: 'c', v: 'three' },
  ];
  const first = encodeRecord(records[0]).length;
  const second = encodeRecord(records[1]).length;

  const flipped = buildLog(records);
  flipped[first + HEADER_BYTES + 2] ^= 0xff;
  const afterFlip = decodeLog(flipped);
  assert.deepEqual(afterFlip.records, [records[0]]);
  assert.equal(afterFlip.bytesUsed, first);
  assert.equal(afterFlip.truncated, true);

  const badLength = buildLog(records);
  badLength[first] = 0xff;
  const afterLength = decodeLog(badLength);
  assert.deepEqual(afterLength.records, [records[0]]);
  assert.equal(afterLength.truncated, true);

  const trailing = buildLog(records);
  const withGarbage = new Uint8Array(trailing.length + 5);
  withGarbage.set(trailing, 0);
  withGarbage.set(new Uint8Array([1, 2, 3, 4, 5]), trailing.length);
  const afterGarbage = decodeLog(withGarbage);
  assert.deepEqual(afterGarbage.records, records);
  assert.equal(afterGarbage.bytesUsed, first + second + encodeRecord(records[2]).length);
  assert.equal(afterGarbage.truncated, true);
});

test('decodeLog survives arbitrary bytes', () => {
  const pick = mulberry32(2468);
  for (let round = 0; round < 200; round += 1) {
    const length = Math.floor(pick() * 40);
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) bytes[index] = Math.floor(pick() * 256);
    const decoded = decodeLog(bytes);
    assert.ok(Array.isArray(decoded.records), 'always returns a record list');
    assert.ok(decoded.bytesUsed >= 0 && decoded.bytesUsed <= bytes.length, 'consumes a real prefix');
    assert.equal(typeof decoded.truncated, 'boolean');
  }
});
