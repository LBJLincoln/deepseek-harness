/**
 * Arithmetic expression evaluator: tokeniser, precedence-climbing parser and a
 * tree walker with named constants, variables and a fixed function table.
 */

import { ExprError, tokenize } from './tokenize.js';
import { parse } from './parse.js';

export { ExprError, tokenize, parse };

const CONSTANTS = { pi: Math.PI, e: Math.E };

const FUNCTIONS = {
  abs: { arity: 1, apply: (args) => Math.abs(args[0]) },
  sqrt: { arity: 1, apply: (args) => Math.sqrt(args[0]) },
  floor: { arity: 1, apply: (args) => Math.floor(args[0]) },
  ceil: { arity: 1, apply: (args) => Math.ceil(args[0]) },
  round: { arity: 1, apply: (args) => Math.round(args[0]) },
  sign: { arity: 1, apply: (args) => Math.sign(args[0]) },
  pow: { arity: 2, apply: (args) => args[0] ** args[1] },
  atan2: { arity: 2, apply: (args) => Math.atan2(args[0], args[1]) },
  min: { arity: null, apply: (args) => Math.min(...args) },
  max: { arity: null, apply: (args) => Math.max(...args) },
};

/**
 * Reject a result that left the finite doubles.
 *
 * @param {number} value computed value
 * @param {{ index: number }} node node the value came from
 * @returns {number} the value itself
 */
function finite(value, node) {
  if (!Number.isFinite(value)) throw new ExprError(`non-finite result at ${node.index}`, node.index);
  return value;
}

/**
 * Resolve a name against the caller's bindings, then the built-in constants.
 *
 * @param {{ name: string, index: number }} node variable node
 * @param {Record<string, unknown>} env caller bindings
 * @returns {number} the bound value
 */
function lookup(node, env) {
  if (env !== null && typeof env === 'object' && Object.hasOwn(env, node.name)) {
    const value = env[node.name];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ExprError(`variable ${node.name} is not a finite number at ${node.index}`, node.index);
    }
    return value;
  }
  if (Object.hasOwn(CONSTANTS, node.name)) return CONSTANTS[node.name];
  throw new ExprError(`unknown variable: ${node.name} at ${node.index}`, node.index);
}

/**
 * Apply one built-in function after checking its arity.
 *
 * @param {{ name: string, args: object[], index: number }} node call node
 * @param {Record<string, unknown>} env caller bindings
 * @returns {number} the call's result
 */
function call(node, env) {
  if (!Object.hasOwn(FUNCTIONS, node.name)) {
    throw new ExprError(`unknown function: ${node.name} at ${node.index}`, node.index);
  }
  const fn = FUNCTIONS[node.name];
  const args = node.args.map((argument) => evaluateNode(argument, env));
  if (fn.arity === null) {
    if (args.length === 0) {
      throw new ExprError(`function ${node.name} expects at least 1 argument, got 0 at ${node.index}`, node.index);
    }
  } else if (args.length !== fn.arity) {
    const plural = fn.arity === 1 ? 'argument' : 'arguments';
    throw new ExprError(`function ${node.name} expects ${fn.arity} ${plural}, got ${args.length} at ${node.index}`, node.index);
  }
  return finite(fn.apply(args), node);
}

/**
 * Evaluate one node of the expression tree.
 *
 * @param {object} node expression node
 * @param {Record<string, unknown>} env caller bindings
 * @returns {number} the node's value
 */
function evaluateNode(node, env) {
  switch (node.type) {
    case 'number':
      return node.value;
    case 'variable':
      return lookup(node, env);
    case 'unary': {
      const value = evaluateNode(node.operand, env);
      return finite(node.op === '-' ? -value : value, node);
    }
    case 'binary': {
      const left = evaluateNode(node.left, env);
      const right = evaluateNode(node.right, env);
      if ((node.op === '/' || node.op === '%') && right === 0) {
        throw new ExprError(`division by zero at ${node.index}`, node.index);
      }
      switch (node.op) {
        case '+':
          return finite(left + right, node);
        case '-':
          return finite(left - right, node);
        case '*':
          return finite(left * right, node);
        case '/':
          return finite(left / right, node);
        case '%':
          return finite(left % right, node);
        default:
          return finite(left ** right, node);
      }
    }
    default:
      return call(node, env);
  }
}

/**
 * Evaluate an expression.
 *
 * @param {string} input expression source
 * @param {Record<string, number>} [env] variable bindings, shadowing the built-in constants
 * @returns {number} the finite result
 */
export function evaluate(input, env = {}) {
  return evaluateNode(parse(input), env);
}
