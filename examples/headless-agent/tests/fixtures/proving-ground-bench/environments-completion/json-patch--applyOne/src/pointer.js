/** JSON Pointer parsing, formatting and resolution over JSON data. */

/** Failure raised while parsing or resolving a pointer. */
export class PointerError extends Error {
  /**
   * @param {string} message reason, including the pointer position when known
   * @param {unknown} [pointer] the pointer the failure came from
   */
  constructor(message, pointer) {
    super(message);
    this.name = 'PointerError';
    this.pointer = pointer;
  }
}

/**
 * Whether a value is a JSON object rather than an array or a primitive.
 *
 * @param {unknown} value value to classify
 * @returns {boolean} true for a non-array object
 */
export function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Name a value for an error message.
 *
 * @param {unknown} value value to describe
 * @returns {string} `null`, `array` or the value's type
 */
export function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Read a reference token as an array index.
 *
 * @param {string} token reference token
 * @returns {number | null} the index, or null when the token is not one
 */
export function arrayIndex(token) {
  if (token === '0') return 0;
  return /^[1-9][0-9]*$/.test(token) ? Number(token) : null;
}

/**
 * Store an own, enumerable property even when the key shadows `Object.prototype`.
 *
 * @param {Record<string, unknown>} target object to write into
 * @param {string} key property name
 * @param {unknown} value property value
 * @returns {void}
 */
export function setOwn(target, key, value) {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}

/**
 * Split a pointer into decoded reference tokens.
 *
 * @param {string} pointer JSON Pointer text
 * @returns {string[]} the decoded tokens, empty for the whole-document pointer
 */
export function parsePointer(pointer) {
  if (typeof pointer !== 'string') throw new PointerError('pointer must be a string', pointer);
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new PointerError(`pointer must be empty or start with '/': ${pointer}`, pointer);

  const tokens = [];
  for (const raw of pointer.slice(1).split('/')) {
    let decoded = '';
    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i];
      if (ch !== '~') {
        decoded += ch;
        continue;
      }
      const next = raw[i + 1];
      if (next !== '0' && next !== '1') {
        throw new PointerError(`invalid escape in pointer token: ~${next ?? ''}`, pointer);
      }
      decoded += next === '0' ? '~' : '/';
      i += 1;
    }
    tokens.push(decoded);
  }
  return tokens;
}

/**
 * Join reference tokens into a pointer.
 *
 * @param {string[]} tokens reference tokens
 * @returns {string} the pointer text, empty for no tokens
 */
export function formatPointer(tokens) {
  if (!Array.isArray(tokens)) throw new PointerError('tokens must be an array', tokens);
  let out = '';
  for (const token of tokens) {
    if (typeof token !== 'string') throw new PointerError(`reference token must be a string: ${String(token)}`, tokens);
    out += `/${token.split('~').join('~0').split('/').join('~1')}`;
  }
  return out;
}

/**
 * Resolve a pointer against a document.
 *
 * @param {unknown} document JSON data to walk
 * @param {string} pointer JSON Pointer text
 * @returns {unknown} the value the pointer selects
 */
export function resolve(document, pointer) {
  const tokens = parsePointer(pointer);
  let current = document;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const at = formatPointer(tokens.slice(0, i + 1));
    if (Array.isArray(current)) {
      const index = arrayIndex(token);
      if (index === null) throw new PointerError(`invalid array index: ${token} at ${at}`, pointer);
      if (index >= current.length) throw new PointerError(`index out of range: ${token} at ${at}`, pointer);
      current = current[index];
      continue;
    }
    if (isObject(current)) {
      if (!Object.hasOwn(current, token)) throw new PointerError(`missing property: ${token} at ${at}`, pointer);
      current = current[token];
      continue;
    }
    throw new PointerError(`cannot index into ${describe(current)} at ${at}`, pointer);
  }
  return current;
}
