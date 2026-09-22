/**
 * Stable multi-key sorting with per-key direction and null placement.
 *
 * Values are ordered without any locale: strings compare by Unicode code
 * point, numbers numerically, booleans with `false` before `true`, and mixed
 * types by type rank (number, then string, then boolean).
 */

/** Type ranks used when a key holds values of several types. */
const TYPE_RANK = { number: 0, string: 1, boolean: 2 };

/**
 * Reports whether a value counts as absent for ordering purposes.
 * @param {unknown} value Value to classify.
 * @returns {boolean} True for null, undefined, and NaN.
 */
function isNullLike(value) {
  return value === null || value === undefined || (typeof value === 'number' && Number.isNaN(value));
}

/**
 * Compares two strings by Unicode code point.
 * @param {string} a First string.
 * @param {string} b Second string.
 * @returns {number} Negative, zero, or positive.
 */
function compareStrings(a, b) {
  if (a === b) return 0;
  const left = a[Symbol.iterator]();
  const right = b[Symbol.iterator]();
  for (;;) {
    const x = left.next();
    const y = right.next();
    if (x.done && y.done) return 0;
    if (x.done) return -1;
    if (y.done) return 1;
    const ca = x.value.codePointAt(0);
    const cb = y.value.codePointAt(0);
    if (ca !== cb) return ca < cb ? -1 : 1;
  }
}

/**
 * Total order over sortable values: absent values first, then numbers,
 * strings, and booleans.
 * @param {unknown} a First value.
 * @param {unknown} b Second value.
 * @returns {number} Negative, zero, or positive.
 * @throws {TypeError} When a value is of an unsupported type.
 */
export function compareValues(a, b) {
  const aNull = isNullLike(a);
  const bNull = isNullLike(b);
  if (aNull || bNull) {
    if (aNull && bNull) return 0;
    return aNull ? -1 : 1;
  }
  const rankA = TYPE_RANK[typeof a];
  const rankB = TYPE_RANK[typeof b];
  if (rankA === undefined) throw new TypeError(`unsupported value type: ${typeof a}`);
  if (rankB === undefined) throw new TypeError(`unsupported value type: ${typeof b}`);
  if (rankA !== rankB) return rankA < rankB ? -1 : 1;
  if (rankA === 1) return compareStrings(a, b);
  if (rankA === 2) return a === b ? 0 : a ? 1 : -1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Builds a reader for one key spec.
 * @param {unknown} key Property path or extractor function.
 * @returns {(row: unknown) => unknown} Value reader.
 * @throws {TypeError} When the key is neither a string nor a function.
 */
function reader(key) {
  if (typeof key === 'function') return key;
  if (typeof key !== 'string') throw new TypeError('key must be a string path or a function');
  const parts = key.split('.');
  return (row) => {
    let value = row;
    for (const part of parts) {
      if (value === null || value === undefined) return undefined;
      value = value[part];
    }
    return value;
  };
}

/**
 * Validates and normalises one key spec.
 * @param {unknown} spec Candidate spec.
 * @returns {{read: (row: unknown) => unknown, sign: number, nullsFirst: boolean}} Prepared spec.
 * @throws {TypeError} When the spec or its key is malformed.
 * @throws {RangeError} When direction or null placement is unknown.
 */
function prepare(spec) {
  if (typeof spec !== 'object' || spec === null) throw new TypeError('key spec must be an object');
  const direction = spec.direction ?? 'asc';
  const nulls = spec.nulls ?? 'last';
  if (direction !== 'asc' && direction !== 'desc') {
    throw new RangeError(`unknown direction: ${JSON.stringify(direction)}`);
  }
  if (nulls !== 'first' && nulls !== 'last') {
    throw new RangeError(`unknown null placement: ${JSON.stringify(nulls)}`);
  }
  return { read: reader(spec.key), sign: direction === 'asc' ? 1 : -1, nullsFirst: nulls === 'first' };
}

/**
 * Validates a list of key specs.
 * @param {unknown} specs Candidate spec list.
 * @returns {Array<{read: (row: unknown) => unknown, sign: number, nullsFirst: boolean}>} Prepared specs.
 * @throws {TypeError} When the list is empty or malformed.
 */
function prepareAll(specs) {
  if (!Array.isArray(specs) || specs.length === 0) throw new TypeError('at least one key spec is required');
  return specs.map(prepare);
}

/**
 * Builds a comparator over rows from a list of key specs.
 * @param {unknown} specs Key specs, applied in order.
 * @returns {(a: unknown, b: unknown) => number} Comparator returning negative, zero, or positive.
 */
export function comparator(specs) {
  const prepared = prepareAll(specs);
  return (a, b) => {
    for (const { read, sign, nullsFirst } of prepared) {
      const left = read(a);
      const right = read(b);
      const leftNull = isNullLike(left);
      const rightNull = isNullLike(right);
      if (leftNull || rightNull) {
        if (leftNull && rightNull) continue;
        return (leftNull ? -1 : 1) * (nullsFirst ? 1 : -1);
      }
      const order = compareValues(left, right);
      if (order !== 0) return order * sign;
    }
    return 0;
  };
}

/**
 * Returns the permutation of row indices that sorts the rows.
 * @param {unknown} rows Rows to order.
 * @param {unknown} specs Key specs, applied in order.
 * @returns {number[]} Indices of `rows` in sorted order, stable for ties.
 * @throws {TypeError} When rows or specs are malformed.
 */
export function sortIndices(rows, specs) {
  if (!Array.isArray(rows)) throw new TypeError('rows must be an array');
  const compare = comparator(specs);
  const indices = rows.map((_, index) => index);
  return indices.sort((i, j) => compare(rows[i], rows[j]) || i - j);
}

/**
 * Sorts rows without mutating the input.
 * @param {unknown} rows Rows to order.
 * @param {unknown} specs Key specs, applied in order.
 * @returns {unknown[]} New array holding the rows in sorted order.
 * @throws {TypeError} When rows or specs are malformed.
 */
export function sortBy(rows, specs) {
  return sortIndices(rows, specs).map((index) => rows[index]);
}
