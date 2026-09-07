/** Precedence-climbing parser producing the expression tree. */

import { ExprError, tokenize } from './tokenize.js';

const BINARY = {
  '+': { precedence: 1, rightAssociative: false },
  '-': { precedence: 1, rightAssociative: false },
  '*': { precedence: 2, rightAssociative: false },
  '/': { precedence: 2, rightAssociative: false },
  '%': { precedence: 2, rightAssociative: false },
  '^': { precedence: 4, rightAssociative: true },
};
const UNARY_PRECEDENCE = 3;

/**
 * Render a token the way error messages quote it.
 *
 * @param {{ type: string, value: number | string }} token token to quote
 * @returns {string} the token's source text
 */
function display(token) {
  return String(token.value);
}

/**
 * @param {{ tokens: object[], index: number, end: number }} state parser state
 * @returns {object | undefined} the next token, if any
 */
function peek(state) {
  return state.tokens[state.index];
}

/**
 * Build the failure for a token that cannot appear here.
 *
 * @param {{ tokens: object[], index: number, end: number }} state parser state
 * @returns {ExprError} the failure to throw
 */
function unexpected(state) {
  const token = peek(state);
  if (token === undefined) return new ExprError(`unexpected end of input at ${state.end}`, state.end);
  return new ExprError(`unexpected token '${display(token)}' at ${token.index}`, token.index);
}

/**
 * Parse a number, name, call or parenthesised group.
 *
 * @param {{ tokens: object[], index: number, end: number }} state parser state
 * @returns {object} expression node
 */
function parsePrimary(state) {
  const token = peek(state);
  if (token === undefined) throw unexpected(state);

  if (token.type === 'number') {
    state.index += 1;
    return { type: 'number', value: token.value, index: token.index };
  }

  if (token.type === 'name') {
    state.index += 1;
    if (peek(state)?.type !== 'lparen') return { type: 'variable', name: token.value, index: token.index };
    state.index += 1;
    const args = [];
    if (peek(state)?.type === 'rparen') {
      state.index += 1;
      return { type: 'call', name: token.value, args, index: token.index };
    }
    for (;;) {
      args.push(parseExpression(state, 1));
      const separator = peek(state);
      if (separator?.type === 'comma') {
        state.index += 1;
        continue;
      }
      if (separator?.type === 'rparen') {
        state.index += 1;
        return { type: 'call', name: token.value, args, index: token.index };
      }
      throw unexpected(state);
    }
  }

  if (token.type === 'lparen') {
    state.index += 1;
    const inner = parseExpression(state, 1);
    const close = peek(state);
    if (close?.type !== 'rparen') {
      const at = close === undefined ? state.end : close.index;
      throw new ExprError(`missing closing parenthesis at ${at}`, at);
    }
    state.index += 1;
    return inner;
  }

  throw unexpected(state);
}

/**
 * Parse a prefix sign, which binds looser than `^` and tighter than `*`.
 *
 * @param {{ tokens: object[], index: number, end: number }} state parser state
 * @returns {object} expression node
 */
function parseUnary(state) {
  const token = peek(state);
  if (token?.type === 'operator' && (token.value === '-' || token.value === '+')) {
    state.index += 1;
    return { type: 'unary', op: token.value, operand: parseExpression(state, UNARY_PRECEDENCE), index: token.index };
  }
  return parsePrimary(state);
}

/**
 * Parse operators at or above a precedence level.
 *
 * @param {{ tokens: object[], index: number, end: number }} state parser state
 * @param {number} minPrecedence lowest precedence this call may consume
 * @returns {object} expression node
 */
function parseExpression(state, minPrecedence) {
  let left = parseUnary(state);
  for (;;) {
    const token = peek(state);
    if (token?.type !== 'operator') break;
    const operator = BINARY[token.value];
    if (operator === undefined || operator.precedence < minPrecedence) break;
    state.index += 1;
    const next = operator.rightAssociative ? operator.precedence : operator.precedence + 1;
    left = { type: 'binary', op: token.value, left, right: parseExpression(state, next), index: token.index };
  }
  return left;
}

/**
 * Parse an expression into a tree.
 *
 * @param {string} input expression source
 * @returns {object} the expression tree; parentheses leave no node behind
 */
export function parse(input) {
  const state = { tokens: tokenize(input), index: 0, end: typeof input === 'string' ? input.length : 0 };
  const node = parseExpression(state, 1);
  if (state.index < state.tokens.length) throw unexpected(state);
  return node;
}
