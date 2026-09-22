/**
 * Semantic versions and ranges: parsing, precedence comparison including
 * prerelease rules, and range matching over caret, tilde, hyphen, wildcard and
 * alternative forms.
 */

export { SemverError, compare, parse } from './version.js';
export { maxSatisfying, parseRange, satisfies } from './range.js';
