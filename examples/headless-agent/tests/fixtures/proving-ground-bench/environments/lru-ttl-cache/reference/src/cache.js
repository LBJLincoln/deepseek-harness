import { Node, RecencyList } from './list.js';

/**
 * Least-recently-used cache with per-entry lifetimes, a byte budget measured
 * by a caller-supplied sizer, and an injectable clock.
 *
 * `get`, `set`, `has`, `peek`, and `delete` are O(1); `prune` and `keys` are
 * linear in the number of stored entries.
 */
export class LruTtlCache {
  /** @type {Map<string, Node>} */
  #nodes = new Map();
  #list = new RecencyList();
  #bytes = 0;
  #maxBytes;
  #ttlMs;
  #clock;
  #sizeOf;
  #onEvict;
  #hits = 0;
  #misses = 0;
  #evictions = 0;
  #expirations = 0;

  /**
   * @param {object} options Cache options.
   * @param {number} options.maxBytes Byte budget; a positive safe integer.
   * @param {number} [options.ttlMs] Default lifetime, `Infinity` by default.
   * @param {() => number} [options.clock] Millisecond clock, `Date.now` by default.
   * @param {(value: unknown, key: string) => number} [options.sizeOf] Sizer, one byte per entry by default.
   * @param {(key: string, value: unknown, reason: string) => void} [options.onEvict] Removal callback.
   */
  constructor(options) {
    if (typeof options !== 'object' || options === null) throw new TypeError('options must be an object');
    const { maxBytes, ttlMs = Number.POSITIVE_INFINITY, clock = Date.now, sizeOf = () => 1, onEvict = () => {} } = options;
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new TypeError('maxBytes must be a positive integer');
    checkTtl(ttlMs);
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    if (typeof sizeOf !== 'function') throw new TypeError('sizeOf must be a function');
    if (typeof onEvict !== 'function') throw new TypeError('onEvict must be a function');
    this.#maxBytes = maxBytes;
    this.#ttlMs = ttlMs;
    this.#clock = clock;
    this.#sizeOf = sizeOf;
    this.#onEvict = onEvict;
  }

  /** @returns {number} Byte budget the cache was built with. */
  get capacity() {
    return this.#maxBytes;
  }

  /** @returns {number} Number of stored entries, expired ones included. */
  get size() {
    return this.#nodes.size;
  }

  /** @returns {number} Bytes charged by the stored entries. */
  get bytes() {
    return this.#bytes;
  }

  /**
   * Removes a node from the store and reports it.
   * @param {Node} node Node to drop.
   * @param {string} reason One of `expire`, `size`, `replace`.
   * @returns {void}
   */
  #drop(node, reason) {
    this.#list.remove(node);
    this.#nodes.delete(node.key);
    this.#bytes -= node.bytes;
    if (reason === 'expire') this.#expirations += 1;
    if (reason === 'size') this.#evictions += 1;
    this.#onEvict(node.key, node.value, reason);
  }

  /**
   * Drops a node if its lifetime has ended.
   * @param {Node} node Node to check.
   * @returns {boolean} True when the node was dropped.
   */
  #dropIfExpired(node) {
    if (!node.isExpired(this.#clock())) return false;
    this.#drop(node, 'expire');
    return true;
  }

  /**
   * Stores a value, replacing any entry already under the key.
   * @param {string} key Cache key.
   * @param {unknown} value Value to store.
   * @param {{ttlMs?: number}} [options] Per-entry lifetime override.
   * @returns {boolean} False when the value alone exceeds the byte budget.
   */
  set(key, value, options = {}) {
    checkKey(key);
    if (typeof options !== 'object' || options === null) throw new TypeError('options must be an object');
    const ttlMs = options.ttlMs ?? this.#ttlMs;
    checkTtl(ttlMs);
    const bytes = this.#sizeOf(value, key);
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new TypeError('sizeOf must return a non-negative safe integer');
    const existing = this.#nodes.get(key);
    if (existing !== undefined) this.#drop(existing, 'replace');
    if (bytes > this.#maxBytes) return false;
    const node = new Node(key, value, bytes, this.#clock(), ttlMs);
    this.#nodes.set(key, node);
    this.#list.append(node);
    this.#bytes += bytes;
    while (this.#bytes > this.#maxBytes) {
      const victim = this.#list.head;
      this.#drop(victim, victim.isExpired(this.#clock()) ? 'expire' : 'size');
    }
    return true;
  }

  /**
   * Reads a value and marks the entry most-recently used.
   * @param {string} key Cache key.
   * @returns {unknown} Stored value, or undefined when absent or expired.
   */
  get(key) {
    checkKey(key);
    const node = this.#nodes.get(key);
    if (node === undefined || this.#dropIfExpired(node)) {
      this.#misses += 1;
      return undefined;
    }
    this.#list.touch(node);
    this.#hits += 1;
    return node.value;
  }

  /**
   * Reads a value without changing recency or hit counters.
   * @param {string} key Cache key.
   * @returns {unknown} Stored value, or undefined when absent or expired.
   */
  peek(key) {
    checkKey(key);
    const node = this.#nodes.get(key);
    if (node === undefined || this.#dropIfExpired(node)) return undefined;
    return node.value;
  }

  /**
   * Reports whether a live entry is stored, without changing recency or hit
   * counters.
   * @param {string} key Cache key.
   * @returns {boolean} True when a live entry exists.
   */
  has(key) {
    checkKey(key);
    const node = this.#nodes.get(key);
    return node !== undefined && !this.#dropIfExpired(node);
  }

  /**
   * Removes an entry without reporting it.
   * @param {string} key Cache key.
   * @returns {boolean} True when an entry was removed.
   */
  delete(key) {
    checkKey(key);
    const node = this.#nodes.get(key);
    if (node === undefined) return false;
    this.#list.remove(node);
    this.#nodes.delete(key);
    this.#bytes -= node.bytes;
    return true;
  }

  /**
   * Removes every entry without reporting any of them.
   * @returns {void}
   */
  clear() {
    this.#nodes = new Map();
    this.#list = new RecencyList();
    this.#bytes = 0;
  }

  /**
   * Removes every entry whose lifetime has ended.
   * @returns {number} How many entries were removed.
   */
  prune() {
    const now = this.#clock();
    let removed = 0;
    for (const node of this.#list) {
      if (node.isExpired(now)) {
        this.#drop(node, 'expire');
        removed += 1;
      }
    }
    return removed;
  }

  /**
   * Lists the live keys after pruning expired entries.
   * @returns {string[]} Keys from least- to most-recently used.
   */
  keys() {
    this.prune();
    return [...this.#list].map((node) => node.key);
  }

  /**
   * Reports cumulative counters.
   * @returns {{hits: number, misses: number, evictions: number, expirations: number}} Counters.
   */
  stats() {
    return { hits: this.#hits, misses: this.#misses, evictions: this.#evictions, expirations: this.#expirations };
  }
}

/**
 * Validates a cache key.
 * @param {unknown} key Candidate key.
 * @returns {void}
 * @throws {TypeError} When the key is not a string.
 */
function checkKey(key) {
  if (typeof key !== 'string') throw new TypeError('key must be a string');
}

/**
 * Validates a lifetime.
 * @param {unknown} ttlMs Candidate lifetime.
 * @returns {void}
 * @throws {TypeError} When the lifetime is not a non-negative number.
 */
function checkTtl(ttlMs) {
  if (typeof ttlMs !== 'number' || Number.isNaN(ttlMs) || ttlMs < 0) {
    throw new TypeError('ttlMs must be a non-negative number');
  }
}
