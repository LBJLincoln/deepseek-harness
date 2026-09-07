/** Semantic version parsing and precedence comparison. */

/** Failure raised by every entry point in this module. */
export class SemverError extends Error {
  /** @param {string} message reason */
  constructor(message) {
    super(message);
    this.name = 'SemverError';
  }
}

const VERSION =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const NUMERIC = /^[0-9]+$/;

/**
 * Convert one prerelease identifier, rejecting padded numbers.
 *
 * @param {string} text raw identifier text
 * @param {string} source version text for the failure message
 * @returns {string | number} the identifier, numeric where it is all digits
 */
function prereleaseIdentifier(text, source) {
  if (!NUMERIC.test(text)) return text;
  if (text.length > 1 && text.startsWith('0')) throw new SemverError(`invalid version: ${source}`);
  return Number(text);
}

/**
 * Parse a semantic version.
 *
 * @param {string} version version text, optionally prefixed with `v` and surrounded by whitespace
 * @returns {{ major: number, minor: number, patch: number, prerelease: (string | number)[], build: string[], version: string }}
 *   the parsed version, with `version` holding the text without the `v` prefix
 */
export function parse(version) {
  if (typeof version !== 'string') throw new SemverError('version must be a string');
  const text = version.trim();
  const matched = VERSION.exec(text);
  if (matched === null) throw new SemverError(`invalid version: ${version}`);
  return {
    major: Number(matched[1]),
    minor: Number(matched[2]),
    patch: Number(matched[3]),
    prerelease: matched[4] === undefined ? [] : matched[4].split('.').map((part) => prereleaseIdentifier(part, version)),
    build: matched[5] === undefined ? [] : matched[5].split('.'),
    version: text.startsWith('v') ? text.slice(1) : text,
  };
}

/**
 * Compare two prerelease identifier lists.
 *
 * @param {(string | number)[]} a left identifiers
 * @param {(string | number)[]} b right identifiers
 * @returns {-1 | 0 | 1} the sign of `a - b` in precedence
 */
function comparePrerelease(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i];
    const right = b[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNumeric = typeof left === 'number';
    const rightNumeric = typeof right === 'number';
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    if (left === right) continue;
    return left < right ? -1 : 1;
  }
  return 0;
}

/**
 * Compare two versions by precedence, ignoring build metadata.
 *
 * @param {string | object} a left version, parsed or as text
 * @param {string | object} b right version, parsed or as text
 * @returns {-1 | 0 | 1} the sign of `a - b`
 */
export function compare(a, b) {
  const left = typeof a === 'string' ? parse(a) : a;
  const right = typeof b === 'string' ? parse(b) : b;
  for (const field of ['major', 'minor', 'patch']) {
    if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}
