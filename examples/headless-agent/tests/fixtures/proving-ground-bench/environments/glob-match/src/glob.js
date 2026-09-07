/**
 * Glob patterns compiled to path matchers: wildcards that stop at `/`,
 * whole-segment globstars, POSIX-style character classes, backslash escapes and
 * the leading-dot rule.
 */

/** Failure raised while compiling a pattern. */
export class GlobError extends Error {
  /**
   * @param {string} message reason, without positional information
   * @param {number} [index] 0-based index into the pattern where the fault starts
   */
  constructor(message, index) {
    super(message);
    this.name = 'GlobError';
    this.index = index;
  }
}

/**
 * Compile a glob pattern into a matcher.
 *
 * @param {string} pattern glob pattern
 * @param {{ dot?: boolean, nocase?: boolean }} [options] leading-dot and case policy
 * @returns {(path: string) => boolean} matcher for whole paths
 */
export function compile(pattern, options = {}) {
  throw new Error('not implemented');
}

/**
 * Test one path against one pattern.
 *
 * @param {string} path path to test
 * @param {string} pattern glob pattern
 * @param {{ dot?: boolean, nocase?: boolean }} [options] leading-dot and case policy
 * @returns {boolean} whether the whole path matches
 */
export function isMatch(path, pattern, options = {}) {
  throw new Error('not implemented');
}

/**
 * Keep the paths that match a pattern, in their original order.
 *
 * @param {string[]} paths paths to filter
 * @param {string} pattern glob pattern
 * @param {{ dot?: boolean, nocase?: boolean }} [options] leading-dot and case policy
 * @returns {string[]} the matching paths
 */
export function filter(paths, pattern, options = {}) {
  throw new Error('not implemented');
}
