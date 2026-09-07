/**
 * Least-recently-used cache with per-entry lifetimes, a byte budget measured
 * by a caller-supplied sizer, and an injectable clock.
 *
 * This starting point stores entries in insertion order and ignores lifetimes,
 * the byte budget, recency, and the eviction callback.
 */
export class LruTtlCache {
  /** @type {Map<string, unknown>} */
  #values = new Map();
  #maxBytes;

  /**
   * @param {object} options Cache options.
   * @param {number} options.maxBytes Byte budget; a positive safe integer.
   * @param {number} [options.ttlMs] Default lifetime, `Infinity` by default.
   * @param {() => number} [options.clock] Millisecond clock, `Date.now` by default.
   * @param {(value: unknown, key: string) => number} [options.sizeOf] Sizer, one byte per entry by default.
   * @param {(key: string, value: unknown, reason: string) => void} [options.onEvict] Removal callback.
   */
  constructor(options) {
    this.#maxBytes = options.maxBytes;
  }

  /** @returns {number} Byte budget the cache was built with. */
  get capacity() {
    return this.#maxBytes;
  }

  /** @returns {number} Number of stored entries, expired ones included. */
  get size() {
    return this.#values.size;
  }

  /** @returns {number} Bytes charged by the stored entries. */
  get bytes() {
    return this.#values.size;
  }

  /**
   * Stores a value, replacing any entry already under the key.
   * @param {string} key Cache key.
   * @param {unknown} value Value to store.
   * @param {{ttlMs?: number}} [options] Per-entry lifetime override.
   * @returns {boolean} False when the value alone exceeds the byte budget.
   */
  set(key, value, options = {}) {
    this.#values.set(key, value);
    return true;
  }

  /**
   * Reads a value and marks the entry most-recently used.
   * @param {string} key Cache key.
   * @returns {unknown} Stored value, or undefined when absent or expired.
   */
  get(key) {
    return this.#values.get(key);
  }

  /**
   * Reads a value without changing recency or hit counters.
   * @param {string} key Cache key.
   * @returns {unknown} Stored value, or undefined when absent or expired.
   */
  peek(key) {
    return this.#values.get(key);
  }

  /**
   * Reports whether a live entry is stored, without changing recency or hit
   * counters.
   * @param {string} key Cache key.
   * @returns {boolean} True when a live entry exists.
   */
  has(key) {
    return this.#values.has(key);
  }

  /**
   * Removes an entry without reporting it.
   * @param {string} key Cache key.
   * @returns {boolean} True when an entry was removed.
   */
  delete(key) {
    return this.#values.delete(key);
  }

  /**
   * Removes every entry without reporting any of them.
   * @returns {void}
   */
  clear() {
    this.#values.clear();
  }

  /**
   * Removes every entry whose lifetime has ended.
   * @returns {number} How many entries were removed.
   */
  prune() {
    return 0;
  }

  /**
   * Lists the live keys after pruning expired entries.
   * @returns {string[]} Keys from least- to most-recently used.
   */
  keys() {
    return [...this.#values.keys()];
  }

  /**
   * Reports cumulative counters.
   * @returns {{hits: number, misses: number, evictions: number, expirations: number}} Counters.
   */
  stats() {
    return { hits: 0, misses: 0, evictions: 0, expirations: 0 };
  }
}
