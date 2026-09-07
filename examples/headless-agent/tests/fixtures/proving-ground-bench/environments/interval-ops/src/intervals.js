/**
 * Set algebra over half-open integer intervals `[start, end)`.
 */

/**
 * Normalises a list of intervals: drops empties, sorts, and coalesces
 * overlapping or touching intervals.
 * @param {unknown} intervals Interval list.
 * @returns {Array<[number, number]>} Normalised list.
 */
export function normalize(intervals) {
  throw new Error('not implemented');
}

/**
 * Union of two interval lists.
 * @param {unknown} a First interval list.
 * @param {unknown} b Second interval list.
 * @returns {Array<[number, number]>} Normalised union.
 */
export function merge(a, b) {
  throw new Error('not implemented');
}

/**
 * Intersection of two interval lists. Touching intervals do not intersect.
 * @param {unknown} a First interval list.
 * @param {unknown} b Second interval list.
 * @returns {Array<[number, number]>} Normalised intersection.
 */
export function intersect(a, b) {
  throw new Error('not implemented');
}

/**
 * Relative complement `a \ b`.
 * @param {unknown} a Interval list to subtract from.
 * @param {unknown} b Interval list to remove.
 * @returns {Array<[number, number]>} Normalised difference.
 */
export function subtract(a, b) {
  throw new Error('not implemented');
}

/**
 * Total length covered by a list of intervals, counting overlaps once.
 * @param {unknown} intervals Interval list.
 * @returns {number} Number of integers covered.
 */
export function coverage(intervals) {
  throw new Error('not implemented');
}
