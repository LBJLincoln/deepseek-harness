/**
 * The `join` subcommand: the inner join of two tables on a named column.
 *
 * This module imports nothing. Its department's branch is cut from the base
 * revision, which carries no other module.
 */

/**
 * @param {string} message diagnostic, without prefix or terminator
 * @returns {Error} a wrong-input failure
 */
function dataError(message) {
  const error = new Error(message);
  error.code = 'data';
  return error;
}

/**
 * Inner-join two tables on one column.
 *
 * @param {{ header: string[], rows: string[][] }} left the left table
 * @param {{ header: string[], rows: string[][] }} right the right table
 * @param {string} column the header name both tables are joined on
 * @returns {{ header: string[], rows: string[][] }} the left columns and the right's other columns
 */
export function join(left, right, column) {
  const leftIndex = left.header.indexOf(column);
  const rightIndex = right.header.indexOf(column);
  if (leftIndex === -1 || rightIndex === -1) throw dataError(`unknown column: ${column}`);
  const carried = right.header.flatMap((_, index) => (index === rightIndex ? [] : [index]));
  for (const index of carried) {
    const name = right.header[index];
    if (left.header.includes(name)) throw dataError(`duplicate column: ${name}`);
  }
  const rows = [];
  for (const leftRow of left.rows) {
    for (const rightRow of right.rows) {
      if (rightRow[rightIndex] !== leftRow[leftIndex]) continue;
      rows.push([...leftRow, ...carried.map(index => rightRow[index])]);
    }
  }
  return { header: [...left.header, ...carried.map(index => right.header[index])], rows };
}
