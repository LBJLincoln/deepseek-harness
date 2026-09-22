/** Lexical analysis for the arithmetic expression language. */

/** Failure raised anywhere in the expression pipeline. */
export class ExprError extends Error {
  /**
   * @param {string} message reason, ending with the position it refers to
   * @param {number} index 0-based index into the source, in UTF-16 code units
   */
  constructor(message, index) {
    super(message);
    this.name = 'ExprError';
    this.index = index;
  }
}

const PUNCTUATION = new Map([
  ['(', 'lparen'],
  [')', 'rparen'],
  [',', 'comma'],
]);
const OPERATORS = new Set(['+', '-', '*', '/', '%', '^']);
const WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f', '\v']);
const NUMBER = /(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;
const NUMBER_TAIL = /[.\dA-Za-z_]/;

/**
 * Split an expression into tokens.
 *
 * @param {string} input expression source
 * @returns {{ type: 'number' | 'name' | 'operator' | 'lparen' | 'rparen' | 'comma', value: number | string, index: number }[]}
 *   tokens in source order
 */
export function tokenize(input) {
  if (typeof input !== 'string') throw new ExprError('input must be a string at 0', 0);
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (WHITESPACE.has(ch)) {
      i += 1;
      continue;
    }
    const punctuation = PUNCTUATION.get(ch);
    if (punctuation !== undefined) {
      tokens.push({ type: punctuation, value: ch, index: i });
      i += 1;
      continue;
    }
    if (OPERATORS.has(ch)) {
      tokens.push({ type: 'operator', value: ch, index: i });
      i += 1;
      continue;
    }
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      NUMBER.lastIndex = i;
      const matched = NUMBER.exec(input);
      const tail = matched === null ? ch : input[i + matched[0].length];
      if (matched === null || (tail !== undefined && NUMBER_TAIL.test(tail))) {
        throw new ExprError(`malformed number at ${i}`, i);
      }
      tokens.push({ type: 'number', value: Number(matched[0]), index: i });
      i += matched[0].length;
      continue;
    }
    NAME.lastIndex = i;
    const name = NAME.exec(input);
    if (name !== null) {
      tokens.push({ type: 'name', value: name[0], index: i });
      i += name[0].length;
      continue;
    }
    throw new ExprError(`unexpected character '${String.fromCodePoint(input.codePointAt(i))}' at ${i}`, i);
  }
  return tokens;
}
