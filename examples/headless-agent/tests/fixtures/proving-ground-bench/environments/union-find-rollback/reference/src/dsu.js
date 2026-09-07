/**
 * Disjoint sets over the elements `0 .. count - 1`, joined by size and undone
 * in reverse order.
 *
 * Every union is recorded, so `undo` and `rollback` restore exactly the state
 * that existed before it: the same roots, the same component sizes, and the
 * same answer from `find` for every element.
 */
export class DisjointSets {
  #parent;
  #size;
  /** @type {Array<{attached: number, root: number}>} */
  #log = [];
  #components;

  /**
   * @param {number} count How many elements the structure holds.
   * @throws {TypeError} When the count is not a non-negative safe integer.
   */
  constructor(count) {
    if (!Number.isSafeInteger(count) || count < 0) throw new TypeError('count must be a non-negative integer');
    this.#parent = Array.from({ length: count }, (_, index) => index);
    this.#size = new Array(count).fill(1);
    this.#components = count;
  }

  /** @returns {number} How many elements the structure holds. */
  get count() {
    return this.#parent.length;
  }

  /** @returns {number} How many disjoint sets exist right now. */
  get components() {
    return this.#components;
  }

  /**
   * Validates an element index.
   * @param {unknown} element Candidate element.
   * @returns {number} The element itself.
   * @throws {RangeError} When the element is outside `0 .. count - 1`.
   */
  #check(element) {
    if (!Number.isSafeInteger(element) || element < 0 || element >= this.#parent.length) {
      throw new RangeError(`element out of range: ${String(element)}`);
    }
    return element;
  }

  /**
   * Finds the representative of an element's set.
   * @param {number} element Element to look up.
   * @returns {number} Root element of the set.
   * @throws {RangeError} When the element is outside the structure.
   */
  find(element) {
    let node = this.#check(element);
    while (this.#parent[node] !== node) node = this.#parent[node];
    return node;
  }

  /**
   * Reports whether two elements share a set.
   * @param {number} a First element.
   * @param {number} b Second element.
   * @returns {boolean} True when both share a representative.
   */
  connected(a, b) {
    return this.find(a) === this.find(b);
  }

  /**
   * Reports how many elements share an element's set.
   * @param {number} element Element to measure.
   * @returns {number} Size of the set.
   */
  sizeOf(element) {
    return this.#size[this.find(element)];
  }

  /**
   * Joins two sets, attaching the smaller under the larger and, on a tie, the
   * larger root index under the smaller.
   * @param {number} a First element.
   * @param {number} b Second element.
   * @returns {boolean} False when both elements already shared a set.
   */
  union(a, b) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return false;
    let root = rootA;
    let attached = rootB;
    if (this.#size[rootB] > this.#size[rootA] || (this.#size[rootB] === this.#size[rootA] && rootB < rootA)) {
      root = rootB;
      attached = rootA;
    }
    this.#parent[attached] = root;
    this.#size[root] += this.#size[attached];
    this.#log.push({ attached, root });
    this.#components -= 1;
    return true;
  }

  /**
   * Marks the current state so it can be restored later.
   * @returns {number} Token naming this state.
   */
  checkpoint() {
    return this.#log.length;
  }

  /**
   * Undoes the most recent union.
   * @returns {boolean} False when no union was left to undo.
   */
  undo() {
    const last = this.#log.pop();
    if (last === undefined) return false;
    this.#size[last.root] -= this.#size[last.attached];
    this.#parent[last.attached] = last.attached;
    this.#components += 1;
    return true;
  }

  /**
   * Undoes unions until the state matches a checkpoint.
   * @param {number} token Token from `checkpoint`.
   * @returns {number} How many unions were undone.
   * @throws {RangeError} When the token does not name a reachable state.
   */
  rollback(token) {
    if (!Number.isSafeInteger(token) || token < 0 || token > this.#log.length) {
      throw new RangeError(`unknown checkpoint: ${String(token)}`);
    }
    let undone = 0;
    while (this.#log.length > token) {
      this.undo();
      undone += 1;
    }
    return undone;
  }

  /**
   * Lists the sets, each sorted ascending, ordered by their smallest member.
   * @returns {number[][]} Current partition.
   */
  groups() {
    /** @type {Map<number, number[]>} */
    const byRoot = new Map();
    for (let element = 0; element < this.#parent.length; element += 1) {
      const root = this.find(element);
      const members = byRoot.get(root);
      if (members === undefined) byRoot.set(root, [element]);
      else members.push(element);
    }
    return [...byRoot.values()].sort((a, b) => a[0] - b[0]);
  }
}
