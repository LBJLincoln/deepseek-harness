/**
 * Set algebra over half-open integer intervals `[start, end)`.
 *
 * A normalised list is sorted by start, holds no empty interval, and no two of
 * its intervals overlap or touch. Every exported function validates its inputs
 * and returns freshly allocated arrays.
 */

/** Message used when a value is not an array of intervals. */
const NOT_A_LIST = 'interval list must be an array';
/** Message used when an element is not a two-element array. */
const NOT_A_PAIR = 'interval must be a two-element array';
/** Message used when a bound is not a safe integer. */
const NOT_INTEGER = 'interval bounds must be safe integers';
/** Message used when a start is greater than its end. */
const INVERTED = 'interval start must not exceed end';

/**
 * Validates one interval and returns a copy of it.
 * @param {unknown} interval Candidate interval.
 * @returns {[number, number]} Copy of the validated interval.
 * @throws {TypeError} When the interval is not a pair of safe integers.
 * @throws {RangeError} When start is greater than end.
 */
function checkInterval(interval) {
  if (!Array.isArray(interval) || interval.length !== 2) throw new TypeError(NOT_A_PAIR);
  const [start, end] = interval;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) throw new TypeError(NOT_INTEGER);
  if (start > end) throw new RangeError(INVERTED);
  return [start, end];
}

/**
 * Validates a list of intervals and returns copies of its non-empty members.
 * @param {unknown} intervals Candidate interval list.
 * @returns {Array<[number, number]>} Copies of the non-empty intervals.
 * @throws {TypeError} When the list or any member is malformed.
 * @throws {RangeError} When any member is inverted.
 */
function checkList(intervals) {
  if (!Array.isArray(intervals)) throw new TypeError(NOT_A_LIST);
  const out = [];
  for (const interval of intervals) {
    const pair = checkInterval(interval);
    if (pair[0] < pair[1]) out.push(pair);
  }
  return out;
}

/**
 * Sorts and coalesces validated intervals in place.
 * @param {Array<[number, number]>} pairs Validated non-empty intervals.
 * @returns {Array<[number, number]>} Normalised list.
 */
function coalesce(pairs) {
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const [start, end] of pairs) {
    const last = out[out.length - 1];
    if (last !== undefined && start <= last[1]) {
      if (end > last[1]) last[1] = end;
    } else {
      out.push([start, end]);
    }
  }
  return out;
}

/**
 * Normalises a list of intervals: drops empties, sorts, and coalesces
 * overlapping or touching intervals.
 * @param {unknown} intervals Interval list.
 * @returns {Array<[number, number]>} Normalised list.
 */
export function normalize(intervals) {
  return coalesce(checkList(intervals));
}

/**
 * Union of two interval lists.
 * @param {unknown} a First interval list.
 * @param {unknown} b Second interval list.
 * @returns {Array<[number, number]>} Normalised union.
 */
export function merge(a, b) {
  return coalesce([...checkList(a), ...checkList(b)]);
}

/**
 * Intersection of two interval lists. Touching intervals do not intersect.
 * @param {unknown} a First interval list.
 * @param {unknown} b Second interval list.
 * @returns {Array<[number, number]>} Normalised intersection.
 */
export function intersect(a, b) {
  const left = coalesce(checkList(a));
  const right = coalesce(checkList(b));
  const out = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const start = Math.max(left[i][0], right[j][0]);
    const end = Math.min(left[i][1], right[j][1]);
    if (start < end) out.push([start, end]);
    if (left[i][1] <= right[j][1]) i += 1;
    else j += 1;
  }
  return out;
}

/**
 * Relative complement `a \ b`.
 * @param {unknown} a Interval list to subtract from.
 * @param {unknown} b Interval list to remove.
 * @returns {Array<[number, number]>} Normalised difference.
 */
export function subtract(a, b) {
  const left = coalesce(checkList(a));
  const right = coalesce(checkList(b));
  const out = [];
  let j = 0;
  for (const [start, end] of left) {
    let cursor = start;
    let k = j;
    while (k < right.length && right[k][1] <= cursor) k += 1;
    j = k;
    while (k < right.length && right[k][0] < end) {
      if (right[k][0] > cursor) out.push([cursor, right[k][0]]);
      cursor = Math.max(cursor, right[k][1]);
      if (cursor >= end) break;
      k += 1;
    }
    if (cursor < end) out.push([cursor, end]);
  }
  return out;
}

/**
 * Total length covered by a list of intervals, counting overlaps once.
 * @param {unknown} intervals Interval list.
 * @returns {number} Number of integers covered.
 */
export function coverage(intervals) {
  let total = 0;
  for (const [start, end] of coalesce(checkList(intervals))) total += end - start;
  return total;
}
