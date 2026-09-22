/**
 * INI reader and writer with quoted tokens, escape sequences and a configurable
 * duplicate-key policy. Parsing and serialising are exact inverses for every
 * document this module can produce.
 */

/** Failure raised by {@link parse} and {@link stringify}. */
export class IniError extends Error {
  /**
   * @param {string} message reason, without positional information
   * @param {number} [line] 1-based line number the failure was found on
   */
  constructor(message, line) {
    super(message);
    this.name = 'IniError';
    this.line = line;
  }
}

const DUPLICATE_POLICIES = new Set(['last', 'first', 'error', 'array']);

const ESCAPE_DECODE = new Map([
  ['\\', '\\'],
  ['"', '"'],
  ['n', '\n'],
  ['r', '\r'],
  ['t', '\t'],
  ['0', '\0'],
  [';', ';'],
  ['#', '#'],
  ['=', '='],
  ['[', '['],
  [']', ']'],
]);

const ESCAPE_ENCODE = new Map([
  ['\\', '\\\\'],
  ['"', '\\"'],
  ['\n', '\\n'],
  ['\r', '\\r'],
  ['\t', '\\t'],
  ['\0', '\\0'],
]);

const VALUE_NEEDS_QUOTE = /["\\\n\r\t\0;#=]/;
const KEY_NEEDS_QUOTE = /["\\\n\r\t\0;#=[\]]/;
const SECTION_NEEDS_QUOTE = /["\\\n\r\t\0[\]]/;

/**
 * Store an own, enumerable property even when the key shadows something on
 * `Object.prototype`.
 *
 * @param {Record<string, unknown>} target container to write into
 * @param {string} key property name
 * @param {unknown} value property value
 * @returns {void}
 */
function setEntry(target, key, value) {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}

/**
 * Read one double-quoted token starting at `start`.
 *
 * @param {string} text line the token appears in
 * @param {number} start index of the opening quote
 * @param {number} line 1-based line number for error reporting
 * @returns {{ value: string, end: number }} decoded text and the index just past the closing quote
 */
function readQuoted(text, start, line) {
  let out = '';
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') return { value: out, end: i + 1 };
    if (ch !== '\\') {
      out += ch;
      i += 1;
      continue;
    }
    const code = text[i + 1];
    if (code === undefined) throw new IniError('unterminated quoted string', line);
    if (code === 'u') {
      const hex = text.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new IniError(`invalid unicode escape: \\u${hex}`, line);
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += 6;
      continue;
    }
    const decoded = ESCAPE_DECODE.get(code);
    if (decoded === undefined) throw new IniError(`unknown escape sequence: \\${code}`, line);
    out += decoded;
    i += 2;
  }
  throw new IniError('unterminated quoted string', line);
}

/**
 * Decode one token that may or may not be quoted.
 *
 * @param {string} token trimmed source text
 * @param {number} line 1-based line number for error reporting
 * @param {string} what noun used in the "unexpected text" message
 * @returns {string} decoded text
 */
function decodeToken(token, line, what) {
  if (!token.startsWith('"')) return token;
  const { value, end } = readQuoted(token, 0, line);
  if (token.slice(end).trim() !== '') throw new IniError(`unexpected text after quoted ${what}`, line);
  return value;
}

/**
 * Record one key/value pair under the active duplicate policy.
 *
 * @param {Record<string, unknown>} target section body to write into
 * @param {string} key decoded key
 * @param {string} value decoded value
 * @param {string} duplicates policy name
 * @param {number} line 1-based line number for error reporting
 * @returns {void}
 */
function assign(target, key, value, duplicates, line) {
  if (!Object.hasOwn(target, key)) {
    setEntry(target, key, value);
    return;
  }
  if (duplicates === 'last') setEntry(target, key, value);
  else if (duplicates === 'error') throw new IniError(`duplicate key: ${key}`, line);
  else if (duplicates === 'array') {
    const existing = target[key];
    setEntry(target, key, Array.isArray(existing) ? [...existing, value] : [existing, value]);
  }
}

/**
 * Parse an INI document.
 *
 * @param {string} text document source
 * @param {{ duplicates?: 'last' | 'first' | 'error' | 'array' }} [options] duplicate-key policy
 * @returns {{ global: Record<string, string | string[]>, sections: Record<string, Record<string, string | string[]>> }}
 *   keys seen before the first header, and one body per section header
 */
export function parse(text, options = {}) {
  if (typeof text !== 'string') throw new IniError('input must be a string');
  const duplicates = options.duplicates ?? 'last';
  if (!DUPLICATE_POLICIES.has(duplicates)) throw new IniError(`unknown duplicates policy: ${duplicates}`);

  const result = { global: {}, sections: {} };
  let current = result.global;
  const lines = text.split(/\r\n|\n|\r/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = i + 1;
    const trimmed = lines[i].trim();
    if (trimmed === '' || trimmed[0] === ';' || trimmed[0] === '#') continue;

    if (trimmed[0] === '[') {
      if (!trimmed.endsWith(']')) throw new IniError('unterminated section header', line);
      const name = decodeToken(trimmed.slice(1, -1).trim(), line, 'section name');
      if (name === '') throw new IniError('empty section name', line);
      if (!Object.hasOwn(result.sections, name)) setEntry(result.sections, name, {});
      current = result.sections[name];
      continue;
    }

    let key;
    let rest;
    if (trimmed[0] === '"') {
      const quoted = readQuoted(trimmed, 0, line);
      const after = trimmed.slice(quoted.end);
      const eq = after.indexOf('=');
      if (eq === -1) throw new IniError("missing '=' in entry", line);
      if (after.slice(0, eq).trim() !== '') throw new IniError('unexpected text after quoted key', line);
      key = quoted.value;
      rest = after.slice(eq + 1);
    } else {
      const eq = trimmed.indexOf('=');
      if (eq === -1) throw new IniError("missing '=' in entry", line);
      key = trimmed.slice(0, eq).trim();
      rest = trimmed.slice(eq + 1);
    }
    if (key === '') throw new IniError('empty key', line);
    assign(current, key, decodeToken(rest.trim(), line, 'value'), duplicates, line);
  }
  return result;
}

/**
 * Wrap text in double quotes, escaping the characters that cannot appear raw.
 *
 * @param {string} text text to quote
 * @returns {string} quoted token
 */
function quote(text) {
  let out = '"';
  for (const ch of text) out += ESCAPE_ENCODE.get(ch) ?? ch;
  return `${out}"`;
}

/**
 * Serialise one value as it would appear to the right of `=`.
 *
 * @param {string} value value text
 * @returns {string} quoted token when quoting is required, otherwise the value itself
 */
export function formatValue(value) {
  if (typeof value !== 'string') throw new IniError(`value must be a string, got ${typeof value}`);
  if (value === '' || value !== value.trim() || value.startsWith('[') || VALUE_NEEDS_QUOTE.test(value)) {
    return quote(value);
  }
  return value;
}

/**
 * Serialise one key as it would appear to the left of `=`.
 *
 * @param {string} key key text
 * @returns {string} quoted token when quoting is required, otherwise the key itself
 */
export function formatKey(key) {
  if (typeof key !== 'string') throw new IniError(`key must be a string, got ${typeof key}`);
  if (key === '') throw new IniError('empty key');
  if (key !== key.trim() || KEY_NEEDS_QUOTE.test(key)) return quote(key);
  return key;
}

/**
 * Serialise one section name including its brackets.
 *
 * @param {string} name section name
 * @returns {string} bracketed header text
 */
function formatSection(name) {
  if (name === '') throw new IniError('empty section name');
  const inner = name !== name.trim() || SECTION_NEEDS_QUOTE.test(name) ? quote(name) : name;
  return `[${inner}]`;
}

/**
 * Append the lines for one key, expanding arrays into repeated entries.
 *
 * @param {string[]} out accumulated output lines
 * @param {string} key key text
 * @param {string | string[]} value value or repeated values
 * @returns {void}
 */
function emit(out, key, value) {
  const token = formatKey(key);
  if (Array.isArray(value)) {
    for (const item of value) out.push(`${token}=${formatValue(item)}`);
    return;
  }
  out.push(`${token}=${formatValue(value)}`);
}

/**
 * Serialise a parsed document back to INI text.
 *
 * @param {{ global?: Record<string, string | string[]>, sections?: Record<string, Record<string, string | string[]>> }} data
 *   document to write
 * @param {{ eol?: string }} [options] line terminator, `'\n'` by default
 * @returns {string} INI text, empty when the document has no entries
 */
export function stringify(data, options = {}) {
  if (data === null || typeof data !== 'object') throw new IniError('document must be an object');
  const eol = options.eol ?? '\n';
  const global = data.global ?? {};
  const sections = data.sections ?? {};
  const out = [];

  for (const key of Object.keys(global)) emit(out, key, global[key]);
  for (const name of Object.keys(sections)) {
    if (out.length > 0) out.push('');
    out.push(formatSection(name));
    const body = sections[name];
    if (body === null || typeof body !== 'object') throw new IniError(`section body must be an object: ${name}`);
    for (const key of Object.keys(body)) emit(out, key, body[key]);
  }
  return out.length === 0 ? '' : out.join(eol) + eol;
}
