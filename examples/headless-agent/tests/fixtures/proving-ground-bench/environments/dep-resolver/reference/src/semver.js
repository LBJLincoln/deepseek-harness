/**
 * A small semantic-version dialect: three numeric parts, and ranges built from
 * comparators, carets and tildes.
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
const OPERATORS = ['>=', '<=', '>', '<', '='];

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
 * Upper bound of a caret range, exclusive.
 *
 * @param {string} text Base version.
 * @returns {string} First version outside the range.
 */
function caretCeiling(text) {
  const { major, minor, patch } = parseVersion(text);
  if (major > 0) return `${major + 1}.0.0`;
  if (minor > 0) return `0.${minor + 1}.0`;
  return `0.0.${patch + 1}`;
}

/**
 * Upper bound of a tilde range, exclusive.
 *
 * @param {string} text Base version.
 * @returns {string} First version outside the range.
 */
function tildeCeiling(text) {
  const { major, minor } = parseVersion(text);
  return `${major}.${minor + 1}.0`;
}

/**
 * Parse a range into comparators that must all hold.
 *
 * @param {string} text Range to parse.
 * @returns {Array<{operator: string, version: string}>} Comparators, empty for `*`.
 */
export function parseRange(text) {
  const fail = () => new ResolveError('BAD_RANGE', `invalid range: ${text}`);
  if (typeof text !== 'string') throw fail();
  const parts = text.trim().split(/\s+/);
  if (parts.length === 1 && parts[0] === '') throw fail();
  if (parts.includes('*')) {
    if (parts.length !== 1) throw fail();
    return [];
  }
  const comparators = [];
  for (const part of parts) {
    try {
      if (part.startsWith('^')) {
        const base = part.slice(1);
        parseVersion(base);
        comparators.push({ operator: '>=', version: base }, { operator: '<', version: caretCeiling(base) });
      } else if (part.startsWith('~')) {
        const base = part.slice(1);
        parseVersion(base);
        comparators.push({ operator: '>=', version: base }, { operator: '<', version: tildeCeiling(base) });
      } else {
        const operator = OPERATORS.find((candidate) => part.startsWith(candidate));
        const base = operator === undefined ? part : part.slice(operator.length);
        parseVersion(base);
        comparators.push({ operator: operator ?? '=', version: base });
      }
    } catch {
      // Any malformed piece makes the whole range malformed.
      throw fail();
    }
  }
  return comparators;
}

/**
 * Test a version against a range.
 *
 * @param {string} version Version to test.
 * @param {string} range Range to test against.
 * @returns {boolean} True when every comparator holds.
 */
export function satisfies(version, range) {
  parseVersion(version);
  return parseRange(range).every((comparator) => {
    const order = compareVersions(version, comparator.version);
    switch (comparator.operator) {
      case '>=':
        return order >= 0;
      case '<=':
        return order <= 0;
      case '>':
        return order > 0;
      case '<':
        return order < 0;
      default:
        return order === 0;
    }
  });
}

/**
 * Highest version of a list that satisfies a range.
 *
 * @param {string[]} versions Candidate versions.
 * @param {string} range Range to satisfy.
 * @returns {string|null} The highest match, or null.
 */
export function maxSatisfying(versions, range) {
  if (!Array.isArray(versions)) throw new ResolveError('BAD_VERSION', `invalid version: ${versions}`);
  let best = null;
  for (const version of versions) {
    if (!satisfies(version, range)) continue;
    if (best === null || compareVersions(version, best) > 0) best = version;
  }
  return best;
}
