/**
 * Disjoint sets over the elements `0 .. count - 1`, joined by size and undone
 * in reverse order.
 *
 * This starting point joins and queries sets but records nothing, so none of
 * the history operations work yet.
 */
export class DisjointSets {
  #parent;
  #size;
  #components;

  /**
   * @param {number} count How many elements the structure holds.
   */
  constructor(count) {
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
   * Finds the representative of an element's set.
   * @param {number} element Element to look up.
   * @returns {number} Root element of the set.
   */
  find(element) {
    let node = element;
    while (this.#parent[node] !== node) node = this.#parent[node];
    for (let step = element; this.#parent[step] !== node; ) {
      const next = this.#parent[step];
      this.#parent[step] = node;
      step = next;
    }
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
    const root = this.#size[rootB] > this.#size[rootA] ? rootB : rootA;
    const attached = root === rootA ? rootB : rootA;
    this.#parent[attached] = root;
    this.#size[root] += this.#size[attached];
    this.#components -= 1;
    return true;
  }

  /**
   * Marks the current state so it can be restored later.
   * @returns {number} Token naming this state.
   */
  checkpoint() {
    throw new Error('not implemented');
  }

  /**
   * Undoes the most recent union.
   * @returns {boolean} False when no union was left to undo.
   */
  undo() {
    throw new Error('not implemented');
  }

  /**
   * Undoes unions until the state matches a checkpoint.
   * @param {number} token Token from `checkpoint`.
   * @returns {number} How many unions were undone.
   */
  rollback(token) {
    throw new Error('not implemented');
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
      if (!byRoot.has(root)) byRoot.set(root, []);
      byRoot.get(root).push(element);
    }
    return [...byRoot.values()].sort((a, b) => a[0] - b[0]);
  }
}
