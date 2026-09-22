/**
 * URL query string reader and writer with bracket-nested keys, arrays,
 * percent-encoding and stable ordering.
 *
 * Keys are split on unencoded brackets before anything is decoded, so a key
 * that contains an encoded bracket stays one name, and a value that contains an
 * encoded `=` stays one value.
 */

const DEFAULT_DEPTH = 5;
const DEFAULT_ARRAY_LIMIT = 20;
const ARRAY_FORMATS = new Set(['indices', 'brackets', 'repeat']);
const INTEGER = /^(?:0|[1-9][0-9]*)$/;
const EXTRA_ENCODED = /[!'()*]/g;

/** Marker for an empty bracket group, which appends instead of naming a member. */
const PUSH = Symbol('push');

/**
 * Store an own, enumerable property even when the key shadows `Object.prototype`.
 *
 * @param {Record<string, unknown>} target object to write into
 * @param {string} key property name
 * @param {unknown} value property value
 * @returns {void}
 */
function setOwn(target, key, value) {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}

/**
 * Decode one key or value component.
 *
 * @param {string} text raw component text
 * @param {boolean} plusAsSpace whether `+` stands for a space
 * @returns {string} the decoded text, or the undecoded text when the escapes are malformed
 */
function decodeComponent(text, plusAsSpace) {
  const spaced = plusAsSpace ? text.split('+').join(' ') : text;
  try {
    return decodeURIComponent(spaced);
  } catch {
    return spaced;
  }
}

/**
 * Split one `key=value` segment at its first unencoded `=`.
 *
 * @param {string} segment raw segment text
 * @returns {{ rawKey: string, rawValue: string }} the two halves, still encoded
 */
function splitPair(segment) {
  const at = segment.indexOf('=');
  if (at === -1) return { rawKey: segment, rawValue: '' };
  return { rawKey: segment.slice(0, at), rawValue: segment.slice(at + 1) };
}

/**
 * Split a raw key into decoded path segments on its unencoded brackets.
 *
 * @param {string} rawKey raw key text
 * @param {number} depth how many bracket groups are structural
 * @param {boolean} plusAsSpace whether `+` stands for a space
 * @returns {(string | symbol)[]} the path, starting with the base name, with a marker for each empty bracket group
 */
function keyPath(rawKey, depth, plusAsSpace) {
  const open = rawKey.indexOf('[');
  if (open === -1) return [decodeComponent(rawKey, plusAsSpace)];

  const segments = [decodeComponent(rawKey.slice(0, open), plusAsSpace)];
  let i = open;
  while (i < rawKey.length && segments.length <= depth) {
    if (rawKey[i] !== '[') break;
    const close = rawKey.indexOf(']', i);
    if (close === -1) break;
    const inner = rawKey.slice(i + 1, close);
    segments.push(inner === '' ? PUSH : decodeComponent(inner, plusAsSpace));
    i = close + 1;
  }
  if (i < rawKey.length) segments.push(decodeComponent(rawKey.slice(i), plusAsSpace));
  return segments;
}

/**
 * The index an empty bracket group appends at.
 *
 * @param {Record<string, unknown>} node container to append to
 * @returns {number} one past the highest integer key, or 0 when there is none
 */
function nextIndex(node) {
  let highest = -1;
  for (const key of Object.keys(node)) {
    if (INTEGER.test(key)) highest = Math.max(highest, Number(key));
  }
  return highest + 1;
}

/**
 * Whether a value is a container the walk can descend into.
 *
 * @param {unknown} value value to classify
 * @returns {boolean} true for a non-null object
 */
function isContainer(value) {
  return typeof value === 'object' && value !== null;
}

/**
 * Record one decoded pair in the working tree.
 *
 * @param {Record<string, unknown>} root working tree
 * @param {string[]} path decoded key path
 * @param {string} value decoded value
 * @returns {void}
 */
function assign(root, path, value) {
  let node = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i] === PUSH ? String(nextIndex(node)) : path[i];
    const existing = Object.hasOwn(node, key) ? node[key] : undefined;
    if (isContainer(existing) && !Array.isArray(existing)) {
      node = existing;
      continue;
    }
    const created = {};
    setOwn(node, key, created);
    node = created;
  }

  const last = path[path.length - 1];
  if (last === PUSH) {
    setOwn(node, String(nextIndex(node)), value);
    return;
  }
  if (!Object.hasOwn(node, last)) {
    setOwn(node, last, value);
    return;
  }
  const existing = node[last];
  if (Array.isArray(existing)) {
    existing.push(value);
    return;
  }
  if (isContainer(existing)) return;
  setOwn(node, last, [existing, value]);
}

/**
 * Turn integer-keyed containers into arrays, dropping missing indices.
 *
 * @param {unknown} node value to convert
 * @param {number} arrayLimit highest index that still allows an array
 * @returns {unknown} the converted value
 */
function compact(node, arrayLimit) {
  if (!isContainer(node) || Array.isArray(node)) return node;

  const keys = Object.keys(node);
  const converted = {};
  for (const key of keys) setOwn(converted, key, compact(node[key], arrayLimit));
  if (keys.length === 0) return converted;
  if (!keys.every((key) => INTEGER.test(key))) return converted;
  if (Math.max(...keys.map(Number)) >= arrayLimit) return converted;
  return keys
    .slice()
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => converted[key]);
}

/**
 * Read a query string.
 *
 * @param {string} input query text, with or without a leading `?` or `#`
 * @param {{ depth?: number, arrayLimit?: number, plusAsSpace?: boolean }} [options] nesting and decoding policy
 * @returns {Record<string, unknown>} the decoded parameters
 */
export function parse(input, options = {}) {
  if (typeof input !== 'string') throw new TypeError('input must be a string');
  const depth = options.depth ?? DEFAULT_DEPTH;
  const arrayLimit = options.arrayLimit ?? DEFAULT_ARRAY_LIMIT;
  const plusAsSpace = options.plusAsSpace !== false;

  const text = input.startsWith('?') || input.startsWith('#') ? input.slice(1) : input;
  const tree = {};
  for (const segment of text.split('&')) {
    if (segment === '') continue;
    const { rawKey, rawValue } = splitPair(segment);
    assign(tree, keyPath(rawKey, depth, plusAsSpace), decodeComponent(rawValue, plusAsSpace));
  }

  const result = {};
  for (const key of Object.keys(tree)) setOwn(result, key, compact(tree[key], arrayLimit));
  return result;
}

/**
 * Percent-encode one key or value component.
 *
 * @param {string} text component text
 * @param {string} space `'plus'` to write spaces as `+`, `'percent'` otherwise
 * @returns {string} the encoded component
 */
function encodeComponent(text, space) {
  const encoded = encodeURIComponent(text).replace(
    EXTRA_ENCODED,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return space === 'plus' ? encoded.split('%20').join('+') : encoded;
}

/**
 * Build the written key for one path.
 *
 * @param {string[]} segments key path
 * @param {string} space space-encoding policy
 * @returns {string} the encoded key, with structural brackets left literal
 */
function keyText(segments, space) {
  let out = encodeComponent(segments[0], space);
  for (const segment of segments.slice(1)) out += `[${encodeComponent(segment, space)}]`;
  return out;
}

/**
 * Walk one value, appending the pairs it produces.
 *
 * @param {string[]} segments key path so far
 * @param {unknown} value value to write
 * @param {{ path: string, value: string | null }[]} pairs accumulated pairs
 * @param {{ arrayFormat: string, skipNull: boolean, space: string }} options writing policy
 * @returns {void}
 */
function collect(segments, value, pairs, options) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return;

  if (value === null) {
    if (options.skipNull) return;
    pairs.push({ path: keyText(segments, options.space), value: null });
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      if (options.arrayFormat === 'repeat') collect(segments, value[i], pairs, options);
      else collect([...segments, options.arrayFormat === 'brackets' ? '' : String(i)], value[i], pairs, options);
    }
    return;
  }

  if (isContainer(value)) {
    for (const key of Object.keys(value)) collect([...segments, key], value[key], pairs, options);
    return;
  }

  pairs.push({ path: keyText(segments, options.space), value: encodeComponent(String(value), options.space) });
}

/**
 * Write a query string.
 *
 * @param {Record<string, unknown>} input parameters to write
 * @param {{ arrayFormat?: string, sort?: boolean, skipNull?: boolean, space?: string }} [options] writing policy
 * @returns {string} the query text, without a leading `?`
 */
export function stringify(input, options = {}) {
  if (!isContainer(input) || Array.isArray(input)) throw new TypeError('input must be an object');
  const arrayFormat = options.arrayFormat ?? 'indices';
  if (!ARRAY_FORMATS.has(arrayFormat)) throw new TypeError(`unknown arrayFormat: ${arrayFormat}`);
  const space = options.space ?? 'percent';
  if (space !== 'percent' && space !== 'plus') throw new TypeError(`unknown space: ${space}`);

  const policy = { arrayFormat, skipNull: options.skipNull === true, space };
  const pairs = [];
  for (const key of Object.keys(input)) collect([key], input[key], pairs, policy);
  if (options.sort === true) {
    pairs.sort((left, right) => {
      if (left.path === right.path) return 0;
      return left.path < right.path ? -1 : 1;
    });
  }
  return pairs.map((pair) => (pair.value === null ? pair.path : `${pair.path}=${pair.value}`)).join('&');
}

/**
 * Take the query part out of a URL.
 *
 * @param {string} url URL or URL fragment
 * @returns {string} the text after the first `?` that precedes any `#`, or the empty string
 */
export function extract(url) {
  if (typeof url !== 'string') throw new TypeError('url must be a string');
  const hash = url.indexOf('#');
  const withoutFragment = hash === -1 ? url : url.slice(0, hash);
  const start = withoutFragment.indexOf('?');
  return start === -1 ? '' : withoutFragment.slice(start + 1);
}
