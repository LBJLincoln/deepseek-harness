/**
 * Pure POSIX-style path arithmetic: no filesystem access, no working directory.
 */

/** Error raised for malformed paths and impossible requests. */
export class PathError extends Error {
  /**
   * @param {string} code Stable machine-readable reason.
   * @param {string} message Human-readable detail.
   */
  constructor(code, message) {
    super(message);
    this.name = 'PathError';
    this.code = code;
  }
}

/**
 * Report whether a path starts at the root.
 *
 * @param {string} path Path to inspect.
 * @returns {boolean} True for a rooted path.
 */
export function isAbsolute(path) {
  throw new Error('not implemented');
}

/**
 * Collapse `.`, `..`, repeated slashes and trailing slashes.
 *
 * @param {string} path Path to normalize.
 * @returns {string} Normalized path.
 */
export function normalize(path) {
  throw new Error('not implemented');
}

/**
 * Join segments and normalize the result.
 *
 * @param {...string} segments One or more path segments.
 * @returns {string} Normalized joined path.
 */
export function join(...segments) {
  throw new Error('not implemented');
}

/**
 * Path from one absolute location to another.
 *
 * @param {string} from Absolute starting path.
 * @param {string} to Absolute destination path.
 * @returns {string} Relative path, empty when the two are the same.
 */
export function relative(from, to) {
  throw new Error('not implemented');
}
