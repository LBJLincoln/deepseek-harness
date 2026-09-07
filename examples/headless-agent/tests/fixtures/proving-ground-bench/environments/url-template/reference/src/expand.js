/** URI template expansion following the operator table. */

import { UriTemplateError, parse } from './parse.js';

const UNRESERVED = /[A-Za-z0-9\-._~]/;
const RESERVED = /[:/?#[\]@!$&'()*+,;=]/;
const HEX_PAIR = /^[0-9A-Fa-f]{2}$/;

const RULES = {
  '': { first: '', separator: ',', named: false, ifEmpty: '', allowReserved: false },
  '+': { first: '', separator: ',', named: false, ifEmpty: '', allowReserved: true },
  '#': { first: '#', separator: ',', named: false, ifEmpty: '', allowReserved: true },
  '.': { first: '.', separator: '.', named: false, ifEmpty: '', allowReserved: false },
  '/': { first: '/', separator: '/', named: false, ifEmpty: '', allowReserved: false },
  ';': { first: ';', separator: ';', named: true, ifEmpty: '', allowReserved: false },
  '?': { first: '?', separator: '&', named: true, ifEmpty: '=', allowReserved: false },
  '&': { first: '&', separator: '&', named: true, ifEmpty: '=', allowReserved: false },
};

const encoder = new TextEncoder();

/**
 * Percent-encode one character as UTF-8 bytes.
 *
 * @param {string} character single code point
 * @returns {string} uppercase percent-encoded triplets
 */
function percentEncode(character) {
  let out = '';
  for (const byte of encoder.encode(character)) out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  return out;
}

/**
 * Encode text, keeping the characters the operator allows.
 *
 * @param {string} text text to encode
 * @param {boolean} allowReserved whether reserved characters and existing triplets pass through
 * @returns {string} the encoded text
 */
function encode(text, allowReserved) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const character = String.fromCodePoint(text.codePointAt(i));
    i += character.length;
    if (UNRESERVED.test(character)) {
      out += character;
      continue;
    }
    if (allowReserved) {
      if (RESERVED.test(character)) {
        out += character;
        continue;
      }
      if (character === '%' && HEX_PAIR.test(text.slice(i, i + 2))) {
        out += text.slice(i - 1, i + 2);
        i += 2;
        continue;
      }
    }
    out += percentEncode(character);
  }
  return out;
}

/**
 * Encode literal template text, which may keep reserved characters.
 *
 * @param {string} text literal text
 * @returns {string} the encoded literal
 */
function encodeLiteral(text) {
  return encode(text, true);
}

/**
 * Convert a scalar value to its text.
 *
 * @param {unknown} value value to convert
 * @param {string} name variable name for the failure message
 * @returns {string} the value's text
 */
function scalar(value, name) {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  throw new UriTemplateError(`value for '${name}' is not a string, number or boolean`);
}

/**
 * Whether a value is a map rather than a list or a scalar.
 *
 * @param {unknown} value value to classify
 * @returns {boolean} true for a non-array object
 */
function isMap(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Join a name and an already-encoded value under a named operator.
 *
 * @param {string} name variable name
 * @param {string} encoded encoded value text
 * @param {{ ifEmpty: string }} rule operator rule
 * @returns {string} the `name=value` piece
 */
function withName(name, encoded, rule) {
  return encoded === '' ? `${name}${rule.ifEmpty}` : `${name}=${encoded}`;
}

/**
 * Expand one variable specification into its pieces.
 *
 * @param {{ name: string, explode: boolean, maxLength: number | null }} spec variable specification
 * @param {unknown} value the bound value
 * @param {object} rule operator rule
 * @returns {string[]} the pieces the separator will join
 */
function expandVariable(spec, value, rule) {
  const { name, explode, maxLength } = spec;
  if (Array.isArray(value)) {
    if (maxLength !== null) throw new UriTemplateError(`prefix modifier applied to a composite value: '${name}'`);
    const items = value.filter((item) => item !== null && item !== undefined).map((item) => encode(scalar(item, name), rule.allowReserved));
    if (explode) return items.map((item) => (rule.named ? withName(name, item, rule) : item));
    const joined = items.join(',');
    return [rule.named ? withName(name, joined, rule) : joined];
  }

  if (isMap(value)) {
    if (maxLength !== null) throw new UriTemplateError(`prefix modifier applied to a composite value: '${name}'`);
    const entries = Object.keys(value)
      .filter((key) => value[key] !== null && value[key] !== undefined)
      .map((key) => [encode(key, rule.allowReserved), encode(scalar(value[key], name), rule.allowReserved)]);
    if (explode) {
      return entries.map(([key, item]) => (rule.named ? withName(key, item, rule) : `${key}=${item}`));
    }
    const joined = entries.flat().join(',');
    return [rule.named ? withName(name, joined, rule) : joined];
  }

  let text = scalar(value, name);
  if (maxLength !== null) text = Array.from(text).slice(0, maxLength).join('');
  const encoded = encode(text, rule.allowReserved);
  return [rule.named ? withName(name, encoded, rule) : encoded];
}

/**
 * Whether a bound value contributes nothing to its expression.
 *
 * @param {unknown} value the bound value
 * @returns {boolean} true when the variable counts as undefined
 */
function isUndefined(value) {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined).length === 0;
  if (isMap(value)) return Object.keys(value).filter((key) => value[key] !== null && value[key] !== undefined).length === 0;
  return false;
}

/**
 * Expand a template against a set of variables.
 *
 * @param {string} template template text
 * @param {Record<string, unknown>} variables values bound by name, read as own properties
 * @returns {string} the expanded URI
 */
export function expand(template, variables) {
  if (variables === null || typeof variables !== 'object') throw new UriTemplateError('variables must be an object');
  let out = '';
  for (const part of parse(template)) {
    if (part.type === 'literal') {
      out += encodeLiteral(part.value);
      continue;
    }
    const rule = RULES[part.operator];
    const pieces = [];
    for (const spec of part.variables) {
      if (!Object.hasOwn(variables, spec.name)) continue;
      const value = variables[spec.name];
      if (isUndefined(value)) continue;
      pieces.push(...expandVariable(spec, value, rule));
    }
    if (pieces.length > 0) out += rule.first + pieces.join(rule.separator);
  }
  return out;
}
