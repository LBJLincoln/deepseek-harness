/** URI template parsing into literal and expression parts. */

/** Failure raised while parsing or expanding a template. */
export class UriTemplateError extends Error {
  /**
   * @param {string} message reason
   * @param {number} [index] 0-based index of the `{` that opens the offending expression
   */
  constructor(message, index) {
    super(message);
    this.name = 'UriTemplateError';
    this.index = index;
  }
}

const OPERATORS = new Set(['+', '#', '.', '/', ';', '?', '&']);
const RESERVED_OPERATORS = new Set(['=', ',', '!', '@', '|']);
const NAME = /^(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2})(?:\.?(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2}))*$/;
const MAX_LENGTH = /^[1-9][0-9]{0,3}$/;

/**
 * Read one variable specification.
 *
 * @param {string} text specification text, such as `name`, `name*` or `name:3`
 * @param {number} index index of the opening brace, for failures
 * @returns {{ name: string, explode: boolean, maxLength: number | null }} the specification
 */
function parseVariable(text, index) {
  if (text === '') throw new UriTemplateError(`empty variable specification at ${index}`, index);
  let name = text;
  let explode = false;
  let maxLength = null;
  if (text.endsWith('*')) {
    explode = true;
    name = text.slice(0, -1);
  } else if (text.includes(':')) {
    const at = text.indexOf(':');
    name = text.slice(0, at);
    const digits = text.slice(at + 1);
    if (!MAX_LENGTH.test(digits)) throw new UriTemplateError(`invalid prefix modifier ':${digits}' at ${index}`, index);
    maxLength = Number(digits);
  }
  if (name === '') throw new UriTemplateError(`empty variable specification at ${index}`, index);
  if (!NAME.test(name)) throw new UriTemplateError(`invalid variable name '${name}' at ${index}`, index);
  return { name, explode, maxLength };
}

/**
 * Split a template into literal and expression parts.
 *
 * @param {string} template template text
 * @returns {({ type: 'literal', value: string } | { type: 'expression', operator: string, variables: object[] })[]}
 *   the parts in order, with adjacent literal text merged
 */
export function parse(template) {
  if (typeof template !== 'string') throw new UriTemplateError('template must be a string');
  const parts = [];
  let literal = '';
  let i = 0;

  while (i < template.length) {
    const ch = template[i];
    if (ch === '}') throw new UriTemplateError(`unexpected '}' at ${i}`, i);
    if (ch !== '{') {
      literal += ch;
      i += 1;
      continue;
    }
    const close = template.indexOf('}', i);
    if (close === -1) throw new UriTemplateError(`unterminated expression at ${i}`, i);
    if (literal !== '') {
      parts.push({ type: 'literal', value: literal });
      literal = '';
    }
    const body = template.slice(i + 1, close);
    if (body === '') throw new UriTemplateError(`empty expression at ${i}`, i);
    const head = body[0];
    if (RESERVED_OPERATORS.has(head)) throw new UriTemplateError(`reserved operator '${head}' at ${i}`, i);
    const operator = OPERATORS.has(head) ? head : '';
    const list = operator === '' ? body : body.slice(1);
    const variables = list.split(',').map((spec) => parseVariable(spec, i));
    parts.push({ type: 'expression', operator, variables });
    i = close + 1;
  }

  if (literal !== '') parts.push({ type: 'literal', value: literal });
  return parts;
}
