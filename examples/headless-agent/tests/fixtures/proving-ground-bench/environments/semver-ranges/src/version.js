/** Semantic version parsing and precedence comparison. */

/** Failure raised by every entry point in this module. */
export class SemverError extends Error {
  /** @param {string} message reason */
  constructor(message) {
    super(message);
    this.name = 'SemverError';
  }
}

const SIMPLE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Parse a semantic version.
 *
 * @param {string} version version text, optionally prefixed with `v` and surrounded by whitespace
 * @returns {{ major: number, minor: number, patch: number, prerelease: (string | number)[], build: string[], version: string }}
 *   the parsed version, with `version` holding the text without the `v` prefix
 */
export function parse(version) {
  if (typeof version !== 'string') throw new SemverError('version must be a string');
  const matched = SIMPLE.exec(version.trim());
  if (matched === null) throw new Error('not implemented');
  return {
    major: Number(matched[1]),
    minor: Number(matched[2]),
    patch: Number(matched[3]),
    prerelease: [],
    build: [],
    version: version.trim(),
  };
}

/**
 * Compare two versions by precedence, ignoring build metadata.
 *
 * @param {string | object} a left version, parsed or as text
 * @param {string | object} b right version, parsed or as text
 * @returns {-1 | 0 | 1} the sign of `a - b`
 */
export function compare(a, b) {
  throw new Error('not implemented');
}
