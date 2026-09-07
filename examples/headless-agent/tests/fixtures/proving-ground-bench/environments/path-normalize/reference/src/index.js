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
 * Reject non-strings and embedded NUL bytes.
 *
 * @param {unknown} value Candidate path or segment.
 * @returns {string} The validated string.
 */
function checkString(value) {
  if (typeof value !== 'string') throw new PathError('NOT_A_STRING', 'path must be a string');
  if (value.includes('\u0000')) throw new PathError('NUL_BYTE', 'path contains a NUL byte');
  return value;
}

/**
 * Report whether a path starts at the root.
 *
 * @param {string} path Path to inspect.
 * @returns {boolean} True for a rooted path.
 */
export function isAbsolute(path) {
  return checkString(path).startsWith('/');
}

/**
 * Collapse `.`, `..`, repeated slashes and trailing slashes.
 *
 * @param {string} path Path to normalize.
 * @returns {string} Normalized path.
 */
export function normalize(path) {
  const input = checkString(path);
  if (input === '') throw new PathError('EMPTY_PATH', 'path must not be empty');
  const rooted = input.startsWith('/');
  const stack = [];
  for (const segment of input.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment !== '..') {
      stack.push(segment);
      continue;
    }
    if (stack.length > 0 && stack[stack.length - 1] !== '..') {
      stack.pop();
    } else if (rooted) {
      throw new PathError('ESCAPE', `path escapes root: ${input}`);
    } else {
      stack.push('..');
    }
  }
  if (rooted) return `/${stack.join('/')}`;
  return stack.length === 0 ? '.' : stack.join('/');
}

/**
 * Join segments and normalize the result.
 *
 * @param {...string} segments One or more path segments.
 * @returns {string} Normalized joined path.
 */
export function join(...segments) {
  if (segments.length === 0) {
    throw new PathError('NO_SEGMENTS', 'join requires at least one segment');
  }
  segments.forEach((segment, index) => {
    checkString(segment);
    if (segment === '') throw new PathError('EMPTY_SEGMENT', `segment ${index} must not be empty`);
    if (index > 0 && segment.startsWith('/')) {
      throw new PathError('ABSOLUTE_SEGMENT', `segment ${index} must be relative`);
    }
  });
  return normalize(segments.join('/'));
}

/**
 * Path from one absolute location to another.
 *
 * @param {string} from Absolute starting path.
 * @param {string} to Absolute destination path.
 * @returns {string} Relative path, empty when the two are the same.
 */
export function relative(from, to) {
  checkString(from);
  checkString(to);
  if (!from.startsWith('/') || !to.startsWith('/')) {
    throw new PathError('NOT_ABSOLUTE', 'both paths must be absolute');
  }
  const fromParts = normalize(from).split('/').filter((part) => part !== '');
  const toParts = normalize(to).split('/').filter((part) => part !== '');
  let common = 0;
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
    common += 1;
  }
  const up = fromParts.slice(common).map(() => '..');
  return [...up, ...toParts.slice(common)].join('/');
}
