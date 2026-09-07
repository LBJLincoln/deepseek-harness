/**
 * Binary min-heap with an index from key to position.
 *
 * `push`, `pop`, `remove`, `decreaseKey`, and `setPriority` run in O(log n);
 * `has`, `peek`, and `priorityOf` are O(1). Entries with equal priority leave
 * the heap in insertion order, and an entry keeps its insertion number for its
 * whole life, so re-prioritising never moves it ahead of an older tie.
 */
export class IndexedHeap {
  /** @type {Array<{key: string, priority: number, seq: number}>} */
  #items = [];
  /** @type {Map<string, number>} */
  #index = new Map();
  #seq = 0;

  /** @returns {number} Number of entries currently held. */
  get size() {
    return this.#items.length;
  }

  /**
   * Orders two entries by priority, then by insertion number.
   * @param {{priority: number, seq: number}} a First entry.
   * @param {{priority: number, seq: number}} b Second entry.
   * @returns {boolean} True when `a` must leave the heap before `b`.
   */
  #before(a, b) {
    return a.priority < b.priority || (a.priority === b.priority && a.seq < b.seq);
  }

  /**
   * Places an entry at a position and records its index.
   * @param {number} position Slot to fill.
   * @param {{key: string, priority: number, seq: number}} item Entry to place.
   * @returns {void}
   */
  #place(position, item) {
    this.#items[position] = item;
    this.#index.set(item.key, position);
  }

  /**
   * Moves an entry towards the root until its parent orders before it.
   * @param {number} start Position to lift.
   * @returns {number} Final position.
   */
  #siftUp(start) {
    const item = this.#items[start];
    let position = start;
    while (position > 0) {
      const parent = (position - 1) >> 1;
      if (!this.#before(item, this.#items[parent])) break;
      this.#place(position, this.#items[parent]);
      position = parent;
    }
    this.#place(position, item);
    return position;
  }

  /**
   * Moves an entry away from the root until both children order after it.
   * @param {number} start Position to lower.
   * @returns {number} Final position.
   */
  #siftDown(start) {
    const item = this.#items[start];
    const count = this.#items.length;
    let position = start;
    for (;;) {
      const left = position * 2 + 1;
      if (left >= count) break;
      const right = left + 1;
      const child = right < count && this.#before(this.#items[right], this.#items[left]) ? right : left;
      if (!this.#before(this.#items[child], item)) break;
      this.#place(position, this.#items[child]);
      position = child;
    }
    this.#place(position, item);
    return position;
  }

  /**
   * Adds an entry.
   * @param {string} key Unique key.
   * @param {number} priority Ordering priority; smaller leaves first.
   * @returns {void}
   * @throws {TypeError} When the key or priority is malformed.
   * @throws {Error} When the key is already held.
   */
  push(key, priority) {
    checkKey(key);
    checkPriority(priority);
    if (this.#index.has(key)) throw new Error(`duplicate key: "${key}"`);
    this.#seq += 1;
    const item = { key, priority, seq: this.#seq };
    this.#items.push(item);
    this.#place(this.#items.length - 1, item);
    this.#siftUp(this.#items.length - 1);
  }

  /**
   * Reads the next entry without removing it.
   * @returns {{key: string, priority: number} | undefined} Next entry, or undefined when empty.
   */
  peek() {
    if (this.#items.length === 0) return undefined;
    return { key: this.#items[0].key, priority: this.#items[0].priority };
  }

  /**
   * Removes and returns the next entry.
   * @returns {{key: string, priority: number} | undefined} Next entry, or undefined when empty.
   */
  pop() {
    if (this.#items.length === 0) return undefined;
    const top = this.#items[0];
    this.#detach(0);
    return { key: top.key, priority: top.priority };
  }

  /**
   * Unlinks the entry at a position and repairs the heap.
   * @param {number} position Slot to vacate.
   * @returns {void}
   */
  #detach(position) {
    const removedKey = this.#items[position].key;
    const last = this.#items.pop();
    this.#index.delete(removedKey);
    if (position < this.#items.length) {
      this.#place(position, last);
      if (this.#siftDown(position) === position) this.#siftUp(position);
    }
  }

  /**
   * Reports whether a key is held.
   * @param {string} key Key to look up.
   * @returns {boolean} True when the key is held.
   */
  has(key) {
    checkKey(key);
    return this.#index.has(key);
  }

  /**
   * Reads the priority stored for a key.
   * @param {string} key Key to look up.
   * @returns {number | undefined} Stored priority, or undefined when absent.
   */
  priorityOf(key) {
    checkKey(key);
    const position = this.#index.get(key);
    return position === undefined ? undefined : this.#items[position].priority;
  }

  /**
   * Lowers the priority of a held key.
   * @param {string} key Key to re-prioritise.
   * @param {number} priority New priority; must not exceed the current one.
   * @returns {void}
   * @throws {ReferenceError} When the key is not held.
   * @throws {RangeError} When the priority would rise.
   */
  decreaseKey(key, priority) {
    checkKey(key);
    checkPriority(priority);
    const position = this.#index.get(key);
    if (position === undefined) throw new ReferenceError(`unknown key: "${key}"`);
    if (priority > this.#items[position].priority) throw new RangeError(`priority must not increase for "${key}"`);
    this.#items[position].priority = priority;
    this.#siftUp(position);
  }

  /**
   * Sets the priority of a held key in either direction.
   * @param {string} key Key to re-prioritise.
   * @param {number} priority New priority.
   * @returns {void}
   * @throws {ReferenceError} When the key is not held.
   */
  setPriority(key, priority) {
    checkKey(key);
    checkPriority(priority);
    const position = this.#index.get(key);
    if (position === undefined) throw new ReferenceError(`unknown key: "${key}"`);
    this.#items[position].priority = priority;
    if (this.#siftDown(position) === position) this.#siftUp(position);
  }

  /**
   * Removes a held key.
   * @param {string} key Key to remove.
   * @returns {boolean} True when an entry was removed.
   */
  remove(key) {
    checkKey(key);
    const position = this.#index.get(key);
    if (position === undefined) return false;
    this.#detach(position);
    return true;
  }

  /**
   * Empties the heap.
   * @returns {Array<{key: string, priority: number}>} Every entry in pop order.
   */
  drain() {
    const out = [];
    for (let entry = this.pop(); entry !== undefined; entry = this.pop()) out.push(entry);
    return out;
  }
}

/**
 * Validates a heap key.
 * @param {unknown} key Candidate key.
 * @returns {void}
 * @throws {TypeError} When the key is not a string.
 */
function checkKey(key) {
  if (typeof key !== 'string') throw new TypeError('key must be a string');
}

/**
 * Validates a priority.
 * @param {unknown} priority Candidate priority.
 * @returns {void}
 * @throws {TypeError} When the priority is not a finite number.
 */
function checkPriority(priority) {
  if (typeof priority !== 'number' || !Number.isFinite(priority)) {
    throw new TypeError('priority must be a finite number');
  }
}
