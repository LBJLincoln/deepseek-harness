/**
 * A key-value store whose only durable form is an append-only log.
 */
import { StoreError, decodeLog, encodeRecord } from './log.js';

const MAX_DEPTH = 32;

/**
 * Report whether a value is representable as JSON without loss.
 *
 * @param {unknown} value Candidate value.
 * @param {number} [depth] Current nesting depth.
 * @returns {boolean} True when the value round-trips through JSON unchanged.
 */
function isJsonValue(value, depth = 0) {
  if (depth > MAX_DEPTH) return false;
  if (value === null) return true;
  const kind = typeof value;
  if (kind === 'string' || kind === 'boolean') return true;
  if (kind === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (kind !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

/**
 * Copy a validated JSON value so stored state never aliases caller state.
 *
 * @param {unknown} value Value to copy.
 * @returns {unknown} Structural copy.
 */
function clone(value) {
  return value === null || typeof value !== 'object' ? value : JSON.parse(JSON.stringify(value));
}

/**
 * Reject keys that cannot be logged.
 *
 * @param {unknown} key Candidate key.
 * @returns {string} The validated key.
 */
function checkKey(key) {
  if (typeof key !== 'string' || key === '') {
    throw new StoreError('BAD_KEY', 'key must be a non-empty string');
  }
  return key;
}

/** Key-value store backed by an in-memory append-only log. */
export class KvStore {
  #map = new Map();

  #chunks = [];

  #bytes = 0;

  #records = 0;

  /**
   * Append one framed record and apply it.
   *
   * @param {{t: string, k: string, v?: unknown}} record Record to append.
   * @returns {void}
   */
  #append(record) {
    const frame = encodeRecord(record);
    this.#chunks.push(frame);
    this.#bytes += frame.length;
    this.#records += 1;
    if (record.t === 'put') this.#map.set(record.k, record.v);
    else this.#map.delete(record.k);
  }

  /**
   * Store a value, appending a record to the log.
   *
   * @param {string} key Non-empty key.
   * @param {unknown} value Any JSON-representable value.
   * @returns {KvStore} This store, for chaining.
   */
  put(key, value) {
    checkKey(key);
    if (!isJsonValue(value)) throw new StoreError('BAD_VALUE', 'value is not serializable');
    this.#append({ t: 'put', k: key, v: clone(value) });
    return this;
  }

  /**
   * Remove a key, appending a record only when the key is present.
   *
   * @param {string} key Non-empty key.
   * @returns {boolean} True when the key existed.
   */
  delete(key) {
    checkKey(key);
    if (!this.#map.has(key)) return false;
    this.#append({ t: 'del', k: key });
    return true;
  }

  /**
   * Read a value.
   *
   * @param {string} key Non-empty key.
   * @returns {unknown} A copy of the stored value, or undefined.
   */
  get(key) {
    checkKey(key);
    return this.#map.has(key) ? clone(this.#map.get(key)) : undefined;
  }

  /**
   * Test for a key.
   *
   * @param {string} key Non-empty key.
   * @returns {boolean} True when the key is present.
   */
  has(key) {
    return this.#map.has(checkKey(key));
  }

  /** @returns {number} Number of live keys. */
  get size() {
    return this.#map.size;
  }

  /** @returns {string[]} Live keys in ascending order. */
  keys() {
    return [...this.#map.keys()].sort();
  }

  /** @returns {Array<[string, unknown]>} Live entries in ascending key order. */
  entries() {
    return this.keys().map((key) => [key, clone(this.#map.get(key))]);
  }

  /** @returns {Uint8Array} A copy of the current log. */
  get log() {
    const out = new Uint8Array(this.#bytes);
    let offset = 0;
    for (const chunk of this.#chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  /** @returns {{records: number, liveKeys: number, deadRecords: number}} Log occupancy. */
  stats() {
    return { records: this.#records, liveKeys: this.#map.size, deadRecords: this.#records - this.#map.size };
  }

  /**
   * Rewrite the log as one put per live key in ascending key order.
   *
   * @returns {{before: number, after: number, reclaimed: number}} Byte counts.
   */
  compact() {
    const before = this.#bytes;
    const chunks = [];
    let bytes = 0;
    for (const key of this.keys()) {
      const frame = encodeRecord({ t: 'put', k: key, v: this.#map.get(key) });
      chunks.push(frame);
      bytes += frame.length;
    }
    this.#chunks = chunks;
    this.#bytes = bytes;
    this.#records = chunks.length;
    return { before, after: bytes, reclaimed: before - bytes };
  }

  /** @returns {{version: number, entries: Array<[string, unknown]>}} Portable snapshot. */
  snapshot() {
    return { version: 1, entries: this.entries() };
  }

  /**
   * Rebuild a store from the intact prefix of a log.
   *
   * @param {Uint8Array} bytes Log bytes, possibly torn or corrupted.
   * @returns {KvStore} Store holding the state of that prefix.
   */
  static replay(bytes) {
    const { records, bytesUsed } = decodeLog(bytes);
    const store = new KvStore();
    for (const record of records) {
      if (record.t === 'put') store.#map.set(record.k, record.v);
      else store.#map.delete(record.k);
    }
    const kept = bytes.slice(0, bytesUsed);
    store.#chunks = kept.length === 0 ? [] : [kept];
    store.#bytes = kept.length;
    store.#records = records.length;
    return store;
  }

  /**
   * Rebuild a store from a snapshot, producing a compact log.
   *
   * @param {{version: number, entries: Array<[string, unknown]>}} snapshot Snapshot to load.
   * @returns {KvStore} Store holding the snapshot state.
   */
  static fromSnapshot(snapshot) {
    if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
      throw new StoreError('BAD_SNAPSHOT', 'snapshot must be an object');
    }
    if (snapshot.version !== 1) throw new StoreError('BAD_SNAPSHOT', 'unsupported snapshot version');
    if (!Array.isArray(snapshot.entries)) throw new StoreError('BAD_SNAPSHOT', 'snapshot entries must be an array');
    const pairs = new Map();
    for (const entry of snapshot.entries) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        throw new StoreError('BAD_SNAPSHOT', 'each snapshot entry must be a key and a value');
      }
      const [key, value] = entry;
      checkKey(key);
      if (!isJsonValue(value)) throw new StoreError('BAD_VALUE', 'value is not serializable');
      if (pairs.has(key)) throw new StoreError('BAD_SNAPSHOT', `duplicate key in snapshot: ${key}`);
      pairs.set(key, value);
    }
    const store = new KvStore();
    for (const key of [...pairs.keys()].sort()) store.put(key, pairs.get(key));
    return store;
  }
}
