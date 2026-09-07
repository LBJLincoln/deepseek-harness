/** Range parsing and matching over semantic versions. */

import { SemverError, compare, parse } from './version.js';

/**
 * Expand a range into readable comparator sets.
 *
 * @param {string} range range text
 * @returns {string[][]} one array of comparator strings per alternative
 */
export function parseRange(range) {
  throw new Error('not implemented');
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
  throw new Error('not implemented');
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
  throw new Error('not implemented');
}
