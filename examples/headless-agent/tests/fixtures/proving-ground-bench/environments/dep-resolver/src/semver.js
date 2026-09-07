/**
 * A small semantic-version dialect: three numeric parts, and ranges built from
 * comparators, carets and tildes.
 *
 * Parsing and ordering of plain versions work; ranges do not exist yet.
 */

/** Error raised for malformed versions, ranges, registries and unsatisfiable graphs. */
export class ResolveError extends Error {
  /**
   * @param {string} code Stable machine-readable reason.
   * @param {string} message Human-readable detail.
   */
  constructor(code, message) {
    super(message);
    this.name = 'ResolveError';
    this.code = code;
  }
}

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Parse a version string.
 *
 * @param {string} text Version to parse.
 * @returns {{major: number, minor: number, patch: number}} Parsed parts.
 */
export function parseVersion(text) {
  const match = typeof text === 'string' ? VERSION_PATTERN.exec(text) : null;
  if (match === null) throw new ResolveError('BAD_VERSION', `invalid version: ${text}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * Order two versions.
 *
 * @param {string} left First version.
 * @param {string} right Second version.
 * @returns {-1|0|1} Comparison result.
 */
export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (const part of ['major', 'minor', 'patch']) {
    if (a[part] !== b[part]) return a[part] < b[part] ? -1 : 1;
  }
  return 0;
}

/**
 * Parse a range into comparators that must all hold.
 *
 * @param {string} text Range to parse.
 * @returns {Array<{operator: string, version: string}>} Comparators, empty for `*`.
 */
export function parseRange(text) {
  throw new Error('not implemented');
}

/**
 * Test a version against a range.
 *
 * @param {string} version Version to test.
 * @param {string} range Range to test against.
 * @returns {boolean} True when every comparator holds.
 */
export function satisfies(version, range) {
  throw new Error('not implemented');
}

/**
 * Highest version of a list that satisfies a range.
 *
 * @param {string[]} versions Candidate versions.
 * @param {string} range Range to satisfy.
 * @returns {string|null} The highest match, or null.
 */
export function maxSatisfying(versions, range) {
  throw new Error('not implemented');
}
