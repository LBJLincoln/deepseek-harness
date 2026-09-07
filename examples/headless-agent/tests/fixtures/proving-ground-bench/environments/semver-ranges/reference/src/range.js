/** Range parsing and matching over semantic versions. */

import { SemverError, compare, parse } from './version.js';

const PARTIAL =
  /^v?(0|[1-9]\d*|[xX*])(?:\.(0|[1-9]\d*|[xX*])(?:\.(0|[1-9]\d*|[xX*]))?)?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const OPERATOR = /^(\^|~|<=|>=|<|>|=)?(.+)$/;
const WILDCARDS = new Set(['x', 'X', '*']);

/**
 * Build a comparator's version from numbers.
 *
 * @param {number} major major number
 * @param {number} minor minor number
 * @param {number} patch patch number
 * @param {(string | number)[]} [prerelease] prerelease identifiers
 * @returns {object} a parsed version with no build metadata
 */
function version(major, minor, patch, prerelease = []) {
  const suffix = prerelease.length > 0 ? `-${prerelease.join('.')}` : '';
  return { major, minor, patch, prerelease, build: [], version: `${major}.${minor}.${patch}${suffix}` };
}

/**
 * Read a possibly partial version such as `1`, `1.2` or `1.x`.
 *
 * @param {string} text partial version text
 * @param {string} source range text for the failure message
 * @returns {{ major: number | null, minor: number | null, patch: number | null, prerelease: (string | number)[] }}
 *   the parts, with null wherever a wildcard or a missing part stands
 */
function parsePartial(text, source) {
  const matched = PARTIAL.exec(text);
  if (matched === null) throw new SemverError(`invalid comparator: ${text} in ${source}`);
  const part = (raw) => (raw === undefined || WILDCARDS.has(raw) ? null : Number(raw));
  const major = part(matched[1]);
  const minor = part(matched[2]);
  const patch = part(matched[3]);
  if (major === null && (minor !== null || patch !== null)) throw new SemverError(`invalid comparator: ${text} in ${source}`);
  if (minor === null && patch !== null) throw new SemverError(`invalid comparator: ${text} in ${source}`);
  if (matched[4] !== undefined && patch === null) throw new SemverError(`invalid comparator: ${text} in ${source}`);
  const prerelease = matched[4] === undefined ? [] : parse(`${major}.${minor}.${patch}-${matched[4]}`).prerelease;
  return { major, minor, patch, prerelease };
}

/**
 * The lowest version a partial admits.
 *
 * @param {{ major: number | null, minor: number | null, patch: number | null, prerelease: (string | number)[] }} partial
 *   partial version
 * @returns {object} the inclusive lower bound
 */
function lowerBound(partial) {
  return version(partial.major ?? 0, partial.minor ?? 0, partial.patch ?? 0, partial.prerelease);
}

/**
 * The first version a partial's wildcard excludes.
 *
 * @param {{ major: number | null, minor: number | null, patch: number | null }} partial partial version
 * @returns {object | null} the exclusive upper bound, or null when the partial names an exact version
 */
function wildcardBound(partial) {
  if (partial.major === null) return null;
  if (partial.minor === null) return version(partial.major + 1, 0, 0);
  if (partial.patch === null) return version(partial.major, partial.minor + 1, 0);
  return null;
}

/**
 * Expand a caret comparator.
 *
 * @param {object} partial partial version
 * @returns {object[]} the comparators it stands for
 */
function caret(partial) {
  const lower = lowerBound(partial);
  let upper;
  if (partial.major > 0 || partial.minor === null) upper = version(partial.major + 1, 0, 0);
  else if (partial.minor > 0 || partial.patch === null) upper = version(0, partial.minor + 1, 0);
  else upper = version(0, 0, partial.patch + 1);
  return [
    { operator: '>=', version: lower },
    { operator: '<', version: upper },
  ];
}

/**
 * Expand a tilde comparator.
 *
 * @param {object} partial partial version
 * @returns {object[]} the comparators it stands for
 */
function tilde(partial) {
  const lower = lowerBound(partial);
  const upper = partial.minor === null ? version(partial.major + 1, 0, 0) : version(partial.major, partial.minor + 1, 0);
  return [
    { operator: '>=', version: lower },
    { operator: '<', version: upper },
  ];
}

/**
 * Expand one whitespace-delimited comparator.
 *
 * @param {string} token comparator text
 * @param {string} source range text for the failure message
 * @returns {object[]} the comparators it stands for
 */
function expand(token, source) {
  const matched = OPERATOR.exec(token);
  if (matched === null) throw new SemverError(`invalid comparator: ${token} in ${source}`);
  const operator = matched[1] ?? '';
  const partial = parsePartial(matched[2], source);
  if (partial.major === null && operator !== '' && operator !== '=') {
    throw new SemverError(`invalid comparator: ${token} in ${source}`);
  }
  if (operator === '^') return caret(partial);
  if (operator === '~') return tilde(partial);

  const upper = wildcardBound(partial);
  const exact = partial.major !== null && partial.minor !== null && partial.patch !== null;
  if (operator === '' || operator === '=') {
    if (exact) return [{ operator: '=', version: lowerBound(partial) }];
    if (upper === null) return [{ operator: '>=', version: version(0, 0, 0) }];
    return [
      { operator: '>=', version: lowerBound(partial) },
      { operator: '<', version: upper },
    ];
  }
  if (operator === '>') return [exact ? { operator: '>', version: lowerBound(partial) } : { operator: '>=', version: upper }];
  if (operator === '<=') return [exact ? { operator: '<=', version: lowerBound(partial) } : { operator: '<', version: upper }];
  return [{ operator, version: lowerBound(partial) }];
}

/**
 * Expand a hyphen range.
 *
 * @param {string} from lower partial version
 * @param {string} to upper partial version
 * @param {string} source range text for the failure message
 * @returns {object[]} the comparators it stands for
 */
function hyphen(from, to, source) {
  const low = parsePartial(from, source);
  const high = parsePartial(to, source);
  const comparators = low.major === null ? [] : [{ operator: '>=', version: lowerBound(low) }];
  const upper = wildcardBound(high);
  if (high.major === null) return comparators.length > 0 ? comparators : [{ operator: '>=', version: version(0, 0, 0) }];
  comparators.push(upper === null ? { operator: '<=', version: lowerBound(high) } : { operator: '<', version: upper });
  return comparators;
}

/**
 * Expand one alternative of a range.
 *
 * @param {string} text alternative text
 * @param {string} source whole range text for the failure message
 * @returns {object[]} the comparators that must all hold
 */
function parseSet(text, source) {
  const normalised = text.replace(/(<=|>=|<|>|=|\^|~)\s+/g, '$1').trim();
  if (normalised === '') return [{ operator: '>=', version: version(0, 0, 0) }];
  const tokens = normalised.split(/\s+/);
  const comparators = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i + 1] === '-' && tokens[i + 2] !== undefined) {
      comparators.push(...hyphen(tokens[i], tokens[i + 2], source));
      i += 2;
      continue;
    }
    if (tokens[i] === '-') throw new SemverError(`invalid range: ${source}`);
    comparators.push(...expand(tokens[i], source));
  }
  return comparators;
}

/**
 * Expand a range into comparator sets.
 *
 * @param {string} range range text
 * @returns {object[][]} one array of comparators per alternative
 */
function comparatorSets(range) {
  if (typeof range !== 'string') throw new SemverError('range must be a string');
  return range.split('||').map((alternative) => parseSet(alternative, range));
}

/**
 * Expand a range into readable comparator sets.
 *
 * @param {string} range range text
 * @returns {string[][]} one array of comparator strings per alternative
 */
export function parseRange(range) {
  return comparatorSets(range).map((set) => set.map((comparator) => `${comparator.operator}${comparator.version.version}`));
}

/**
 * Test one comparator.
 *
 * @param {object} candidate parsed version
 * @param {{ operator: string, version: object }} comparator comparator to apply
 * @returns {boolean} whether the version satisfies it
 */
function holds(candidate, comparator) {
  const order = compare(candidate, comparator.version);
  switch (comparator.operator) {
    case '=':
      return order === 0;
    case '>':
      return order > 0;
    case '>=':
      return order >= 0;
    case '<':
      return order < 0;
    default:
      return order <= 0;
  }
}

/**
 * Test a version against one comparator set.
 *
 * @param {object} candidate parsed version
 * @param {object[]} set comparators that must all hold
 * @param {{ includePrerelease?: boolean }} options prerelease policy
 * @returns {boolean} whether the set admits the version
 */
function setAdmits(candidate, set, options) {
  for (const comparator of set) {
    if (!holds(candidate, comparator)) return false;
  }
  if (candidate.prerelease.length === 0 || options.includePrerelease === true) return true;
  return set.some(
    (comparator) =>
      comparator.version.prerelease.length > 0 &&
      comparator.version.major === candidate.major &&
      comparator.version.minor === candidate.minor &&
      comparator.version.patch === candidate.patch,
  );
}

/**
 * Test whether a version satisfies a range.
 *
 * @param {string} candidate version text
 * @param {string} range range text
 * @param {{ includePrerelease?: boolean }} [options] prerelease policy
 * @returns {boolean} whether some alternative admits the version
 */
export function satisfies(candidate, range, options = {}) {
  const parsed = parse(candidate);
  return comparatorSets(range).some((set) => setAdmits(parsed, set, options));
}

/**
 * Pick the highest version that satisfies a range.
 *
 * @param {string[]} versions candidate versions
 * @param {string} range range text
 * @param {{ includePrerelease?: boolean }} [options] prerelease policy
 * @returns {string | null} the winning version as it was written, or null when none match
 */
export function maxSatisfying(versions, range, options = {}) {
  if (!Array.isArray(versions)) throw new SemverError('versions must be an array');
  const sets = comparatorSets(range);
  let best = null;
  let bestParsed = null;
  for (const candidate of versions) {
    const parsed = parse(candidate);
    if (!sets.some((set) => setAdmits(parsed, set, options))) continue;
    if (bestParsed === null || compare(parsed, bestParsed) > 0) {
      best = candidate;
      bestParsed = parsed;
    }
  }
  return best;
}
