/**
 * Binary min-heap with an index from key to position.
 *
 * This starting point keeps entries in a plain array and scans it to find the
 * next one; the index, the ordering guarantees for equal priorities, and the
 * keyed operations are missing.
 */
export class IndexedHeap {
  /** @type {Array<{key: string, priority: number}>} */
  #items = [];

  /** @returns {number} Number of entries currently held. */
  get size() {
    return this.#items.length;
  }

  /**
   * Adds an entry.
   * @param {string} key Unique key.
   * @param {number} priority Ordering priority; smaller leaves first.
   * @returns {void}
   */
  push(key, priority) {
    this.#items.push({ key, priority });
  }

  /**
   * Reads the next entry without removing it.
   * @returns {{key: string, priority: number} | undefined} Next entry, or undefined when empty.
   */
  peek() {
    let best;
    for (const item of this.#items) {
      if (best === undefined || item.priority < best.priority) best = item;
    }
    return best === undefined ? undefined : { key: best.key, priority: best.priority };
  }

  /**
   * Removes and returns the next entry.
   * @returns {{key: string, priority: number} | undefined} Next entry, or undefined when empty.
   */
  pop() {
    const next = this.peek();
    if (next === undefined) return undefined;
    this.#items = this.#items.filter((item) => item.key !== next.key);
    return next;
  }

  /**
   * Reports whether a key is held.
   * @param {string} key Key to look up.
   * @returns {boolean} True when the key is held.
   */
  has(key) {
    return this.#items.some((item) => item.key === key);
  }

  /**
   * Reads the priority stored for a key.
   * @param {string} key Key to look up.
   * @returns {number | undefined} Stored priority, or undefined when absent.
   */
  priorityOf(key) {
    throw new Error('not implemented');
  }

  /**
   * Lowers the priority of a held key.
   * @param {string} key Key to re-prioritise.
   * @param {number} priority New priority; must not exceed the current one.
   * @returns {void}
   */
  decreaseKey(key, priority) {
    throw new Error('not implemented');
  }

  /**
   * Sets the priority of a held key in either direction.
   * @param {string} key Key to re-prioritise.
   * @param {number} priority New priority.
   * @returns {void}
   */
  setPriority(key, priority) {
    throw new Error('not implemented');
  }

  /**
   * Removes a held key.
   * @param {string} key Key to remove.
   * @returns {boolean} True when an entry was removed.
   */
  remove(key) {
    throw new Error('not implemented');
  }

  /**
   * Empties the heap.
   * @returns {Array<{key: string, priority: number}>} Every entry in pop order.
   */
  drain() {
    throw new Error('not implemented');
  }
}
