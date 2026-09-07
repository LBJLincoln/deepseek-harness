/**
 * Arithmetic expression evaluator: tokeniser, precedence-climbing parser and a
 * tree walker with named constants, variables and a fixed function table.
 */

import { ExprError, tokenize } from './tokenize.js';
import { parse } from './parse.js';

export { ExprError, tokenize, parse };

const BARE_NUMBER = /^\s*(\d+(?:\.\d+)?)\s*$/;

/**
 * Evaluate an expression.
 *
 * @param {string} input expression source
 * @param {Record<string, number>} [env] variable bindings, shadowing the built-in constants
 * @returns {number} the finite result
 */
export function evaluate(input, env = {}) {
  const bare = typeof input === 'string' ? BARE_NUMBER.exec(input) : null;
  if (bare !== null) return Number(bare[1]);
  throw new Error('not implemented');
}
