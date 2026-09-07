/**
 * Intrusive doubly linked list ordered from least- to most-recently used.
 *
 * Every operation is O(1); nodes carry their own links so a caller holding a
 * node can move or drop it without a search.
 */

/** One entry in the recency list. */
export class Node {
  /**
   * @param {string} key Cache key.
   * @param {unknown} value Stored value.
   * @param {number} bytes Size charged to the cache.
   * @param {number} storedAt Clock reading when the entry was stored.
   * @param {number} ttlMs Lifetime in milliseconds, possibly Infinity.
   */
  constructor(key, value, bytes, storedAt, ttlMs) {
    this.key = key;
    this.value = value;
    this.bytes = bytes;
    this.storedAt = storedAt;
    this.ttlMs = ttlMs;
    /** @type {Node | null} */
    this.prev = null;
    /** @type {Node | null} */
    this.next = null;
  }

  /**
   * Reports whether the entry has reached the end of its lifetime.
   * @param {number} now Current clock reading.
   * @returns {boolean} True once `now - storedAt` reaches the lifetime.
   */
  isExpired(now) {
    return now - this.storedAt >= this.ttlMs;
  }
}

/** Doubly linked list whose head is the least-recently used node. */
export class RecencyList {
  constructor() {
    /** @type {Node | null} */
    this.head = null;
    /** @type {Node | null} */
    this.tail = null;
    this.length = 0;
  }

  /**
   * Appends a node as the most-recently used entry.
   * @param {Node} node Node to append.
   * @returns {void}
   */
  append(node) {
    node.prev = this.tail;
    node.next = null;
    if (this.tail === null) this.head = node;
    else this.tail.next = node;
    this.tail = node;
    this.length += 1;
  }

  /**
   * Unlinks a node.
   * @param {Node} node Node to remove.
   * @returns {void}
   */
  remove(node) {
    if (node.prev === null) this.head = node.next;
    else node.prev.next = node.next;
    if (node.next === null) this.tail = node.prev;
    else node.next.prev = node.prev;
    node.prev = null;
    node.next = null;
    this.length -= 1;
  }

  /**
   * Moves a node to the most-recently used end.
   * @param {Node} node Node to move.
   * @returns {void}
   */
  touch(node) {
    if (this.tail === node) return;
    this.remove(node);
    this.append(node);
  }

  /**
   * Walks the list from least- to most-recently used.
   * @yields {Node} Each node in recency order.
   * @returns {Generator<Node>} Iterator over the nodes.
   */
  *[Symbol.iterator]() {
    let node = this.head;
    while (node !== null) {
      const next = node.next;
      yield node;
      node = next;
    }
  }
}
