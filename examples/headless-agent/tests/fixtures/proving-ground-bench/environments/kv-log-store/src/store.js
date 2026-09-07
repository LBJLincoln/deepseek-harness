/**
 * A key-value store whose only durable form is an append-only log.
 *
 * The in-memory half works; nothing is written to or read back from a log yet.
 */
import { StoreError } from './log.js';

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

  /**
   * Store a value, appending a record to the log.
   *
   * @param {string} key Non-empty key.
   * @param {unknown} value Any JSON-representable value.
   * @returns {KvStore} This store, for chaining.
   */
  put(key, value) {
    this.#map.set(checkKey(key), value);
    return this;
  }

  /**
   * Remove a key, appending a record only when the key is present.
   *
   * @param {string} key Non-empty key.
   * @returns {boolean} True when the key existed.
   */
  delete(key) {
    return this.#map.delete(checkKey(key));
  }

  /**
   * Read a value.
   *
   * @param {string} key Non-empty key.
   * @returns {unknown} A copy of the stored value, or undefined.
   */
  get(key) {
    return this.#map.get(checkKey(key));
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
    return this.keys().map((key) => [key, this.#map.get(key)]);
  }

  /** @returns {Uint8Array} A copy of the current log. */
  get log() {
    return new Uint8Array(0);
  }

  /** @returns {{records: number, liveKeys: number, deadRecords: number}} Log occupancy. */
  stats() {
    return { records: 0, liveKeys: this.#map.size, deadRecords: 0 };
  }

  /**
   * Rewrite the log as one put per live key in ascending key order.
   *
   * @returns {{before: number, after: number, reclaimed: number}} Byte counts.
   */
  compact() {
    throw new Error('not implemented');
  }

  /** @returns {{version: number, entries: Array<[string, unknown]>}} Portable snapshot. */
  snapshot() {
    throw new Error('not implemented');
  }

  /**
   * Rebuild a store from the intact prefix of a log.
   *
   * @param {Uint8Array} bytes Log bytes, possibly torn or corrupted.
   * @returns {KvStore} Store holding the state of that prefix.
   */
  static replay(bytes) {
    throw new Error('not implemented');
  }

  /**
   * Rebuild a store from a snapshot, producing a compact log.
   *
   * @param {{version: number, entries: Array<[string, unknown]>}} snapshot Snapshot to load.
   * @returns {KvStore} Store holding the snapshot state.
   */
  static fromSnapshot(snapshot) {
    throw new Error('not implemented');
  }
}
