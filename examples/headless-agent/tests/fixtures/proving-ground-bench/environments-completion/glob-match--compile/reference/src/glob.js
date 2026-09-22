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

const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/;
const CLASS_SPECIAL = /[\\\]^-]/;

/**
 * Escape one character for use outside a character class.
 *
 * @param {string} ch single UTF-16 code unit
 * @returns {string} regular-expression source matching that character
 */
function literal(ch) {
  return REGEXP_SPECIAL.test(ch) ? `\\${ch}` : ch;
}

/**
 * Escape one character for use inside a character class.
 *
 * @param {string} ch single UTF-16 code unit
 * @returns {string} regular-expression source usable between class brackets
 */
function classLiteral(ch) {
  return CLASS_SPECIAL.test(ch) ? `\\${ch}` : ch;
}

/**
 * Compile a bracket expression starting at `start`.
 *
 * @param {string} segment pattern segment
 * @param {number} start index of the opening bracket
 * @param {number} offset index of the segment within the whole pattern
 * @returns {{ source: string, end: number }} class source and the index just past the closing bracket
 */
function compileClass(segment, start, offset) {
  let i = start + 1;
  let negated = false;
  if (segment[i] === '!' || segment[i] === '^') {
    negated = true;
    i += 1;
  }
  const firstIndex = i;
  let body = '';
  while (i < segment.length) {
    const ch = segment[i];
    if (ch === ']' && i > firstIndex) {
      return { source: negated ? `[^/${body}]` : `[${body}]`, end: i + 1 };
    }
    if (ch === '/') throw new GlobError('path separator in character class', offset + i);
    if (ch === '\\') {
      const next = segment[i + 1];
      if (next === undefined) throw new GlobError('trailing backslash', offset + i);
      body += classLiteral(next);
      i += 2;
      continue;
    }
    body += ch === '-' ? '-' : classLiteral(ch);
    i += 1;
  }
  throw new GlobError('unterminated character class', offset + start);
}

/**
 * Compile one path segment of a pattern.
 *
 * @param {string} segment pattern segment, never containing an unescaped separator
 * @param {number} offset index of the segment within the whole pattern
 * @returns {string} regular-expression source for the segment
 */
function compileSegment(segment, offset) {
  let source = '';
  let i = 0;
  while (i < segment.length) {
    const ch = segment[i];
    if (ch === '\\') {
      const next = segment[i + 1];
      if (next === undefined) throw new GlobError('trailing backslash', offset + i);
      source += literal(next);
      i += 2;
      continue;
    }
    if (ch === '*') {
      source += '[^/]*';
      while (segment[i] === '*') i += 1;
      continue;
    }
    if (ch === '?') {
      source += '[^/]';
      i += 1;
      continue;
    }
    if (ch === '[') {
      const compiled = compileClass(segment, i, offset);
      source += compiled.source;
      i = compiled.end;
      continue;
    }
    source += literal(ch);
    i += 1;
  }
  return source;
}

/**
 * Split a pattern on separators that are neither escaped nor inside a class.
 *
 * @param {string} pattern glob pattern
 * @returns {{ text: string, offset: number }[]} segments with their positions
 */
function splitSegments(pattern) {
  const segments = [];
  let start = 0;
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '[') {
      let j = i + 1;
      if (pattern[j] === '!' || pattern[j] === '^') j += 1;
      if (pattern[j] === ']') j += 1;
      while (j < pattern.length && pattern[j] !== ']') j += pattern[j] === '\\' ? 2 : 1;
      if (j >= pattern.length) break;
      i = j + 1;
      continue;
    }
    if (ch === '/') {
      segments.push({ text: pattern.slice(start, i), offset: start });
      start = i + 1;
    }
    i += 1;
  }
  segments.push({ text: pattern.slice(start), offset: start });
  return segments;
}

/**
 * Compile a glob pattern into a matcher.
 *
 * @param {string} pattern glob pattern
 * @param {{ dot?: boolean, nocase?: boolean }} [options] leading-dot and case policy
 * @returns {(path: string) => boolean} matcher for whole paths
 */
export function compile(pattern, options = {}) {
  if (typeof pattern !== 'string') throw new GlobError('pattern must be a string');
  if (pattern === '') throw new GlobError('pattern must not be empty');

  const parts = [];
  for (const part of splitSegments(pattern)) {
    if (part.text === '**' && parts.length > 0 && parts[parts.length - 1].text === '**') continue;
    parts.push(part);
  }

  const guard = options.dot === true ? '' : '(?!\\.)';
  let source = '^';
  for (let i = 0; i < parts.length; i += 1) {
    const { text, offset } = parts[i];
    const last = i === parts.length - 1;
    if (text === '**') {
      if (i === 0) source += last ? `(?:${guard}[^/]+(?:/${guard}[^/]+)*)?` : `(?:${guard}[^/]+/)*`;
      else source += `(?:/${guard}[^/]+)*`;
      continue;
    }
    const dotted = text.startsWith('.') || text.startsWith('\\.');
    const compiled = (dotted ? '' : guard) + compileSegment(text, offset);
    const glued = i === 0 || (parts[i - 1].text === '**' && i === 1);
    source += glued ? compiled : `/${compiled}`;
  }
  source += '$';

  const regexp = new RegExp(source, options.nocase === true ? 'i' : '');
  return (path) => {
    if (typeof path !== 'string') throw new GlobError('path must be a string');
    return regexp.test(path);
  };
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
  return compile(pattern, options)(path);
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
  if (!Array.isArray(paths)) throw new GlobError('paths must be an array');
  const matcher = compile(pattern, options);
  return paths.filter((path) => matcher(path));
}
