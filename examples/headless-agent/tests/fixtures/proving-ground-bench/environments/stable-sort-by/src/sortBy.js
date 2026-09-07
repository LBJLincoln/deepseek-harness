/**
 * Stable multi-key sorting with per-key direction and null placement.
 */

/**
 * Total order over sortable values: absent values first, then numbers,
 * strings, and booleans.
 * @param {unknown} a First value.
 * @param {unknown} b Second value.
 * @returns {number} Negative, zero, or positive.
 */
export function compareValues(a, b) {
  throw new Error('not implemented');
}

/**
 * Builds a comparator over rows from a list of key specs.
 * @param {unknown} specs Key specs, applied in order.
 * @returns {(a: unknown, b: unknown) => number} Comparator returning negative, zero, or positive.
 */
export function comparator(specs) {
  throw new Error('not implemented');
}

/**
 * Returns the permutation of row indices that sorts the rows.
 * @param {unknown} rows Rows to order.
 * @param {unknown} specs Key specs, applied in order.
 * @returns {number[]} Indices of `rows` in sorted order, stable for ties.
 */
export function sortIndices(rows, specs) {
  throw new Error('not implemented');
}

/**
 * Sorts rows without mutating the input.
 * @param {unknown} rows Rows to order.
 * @param {unknown} specs Key specs, applied in order.
 * @returns {unknown[]} New array holding the rows in sorted order.
 */
export function sortBy(rows, specs) {
  throw new Error('not implemented');
}
