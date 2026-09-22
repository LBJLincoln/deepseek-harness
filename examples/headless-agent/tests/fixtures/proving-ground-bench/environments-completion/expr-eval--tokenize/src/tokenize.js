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
  throw new Error('not implemented')
}
