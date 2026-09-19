/**
 * The `filter` subcommand: the rows whose named column matches an operator and
 * a value.
 *
 * This module imports nothing. Its department's branch is cut from the base
 * revision, which carries no other module, so the number rule the specification
 * states is restated here rather than shared.
 */

/** A value is a number exactly when it matches this from end to end. */
const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

/** The operators a filter may name. */
const OPERATORS = ['=', '!=', '<', '>', 'contains'];

/**
 * @param {string} message diagnostic, without prefix or terminator
 * @param {'usage' | 'data'} code error class the command line maps to an exit code
 * @returns {Error} the failure
 */
function failure(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Order a cell against an operand: numerically when both are numbers, by UTF-16
 * code unit otherwise.
 *
 * @param {string} cell the row's value
 * @param {string} value the operand from the command line
 * @returns {number} negative, zero or positive
 */
function compare(cell, value) {
  if (NUMBER.test(cell) && NUMBER.test(value)) return Number(cell) - Number(value);
  if (cell < value) return -1;
  return cell > value ? 1 : 0;
}

/**
 * @param {string} cell the row's value
 * @param {string} operator one of {@link OPERATORS}
 * @param {string} value the operand from the command line
 * @returns {boolean} whether the row is kept
 */
function matches(cell, operator, value) {
  if (operator === '=') return cell === value;
  if (operator === '!=') return cell !== value;
  if (operator === 'contains') return cell.includes(value);
  return operator === '<' ? compare(cell, value) < 0 : compare(cell, value) > 0;
}

/**
 * Keep the rows whose named column matches.
 *
 * @param {{ header: string[], rows: string[][] }} table the parsed input
 * @param {string} column header name to test
 * @param {string} operator one of {@link OPERATORS}
 * @param {string} value the operand from the command line
 * @returns {{ header: string[], rows: string[][] }} the input header and the matching rows
 */
export function filter(table, column, operator, value) {
  if (!OPERATORS.includes(operator)) throw failure(`unknown operator: ${operator}`, 'usage');
  const index = table.header.indexOf(column);
  if (index === -1) throw failure(`unknown column: ${column}`, 'data');
  return { header: table.header, rows: table.rows.filter(row => matches(row[index], operator, value)) };
}
