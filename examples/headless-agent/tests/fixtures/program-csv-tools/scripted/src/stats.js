/**
 * The `stats` subcommand: count, minimum, maximum and mean of every numeric
 * column, in header order.
 */

/** A value is a number exactly when it matches this from end to end. */
const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

/**
 * @param {number} value result to print
 * @returns {string} the value rounded to six decimal places
 */
function formatNumber(value) {
  return String(Math.round(value * 1e6) / 1e6);
}

/**
 * Summarise every numeric column of a table.
 *
 * @param {{ header: string[], rows: string[][] }} table the parsed input
 * @returns {{ header: string[], rows: string[][] }} one row per numeric column
 */
export function stats(table) {
  const rows = [];
  for (const [column, name] of table.header.entries()) {
    const values = [];
    let numeric = true;
    for (const row of table.rows) {
      const cell = row[column];
      if (cell === '') continue;
      if (!NUMBER.test(cell)) {
        numeric = false;
        break;
      }
      values.push(Number(cell));
    }
    if (!numeric || values.length === 0) continue;
    const total = values.reduce((sum, value) => sum + value, 0);
    rows.push([
      name,
      String(values.length),
      formatNumber(Math.min(...values)),
      formatNumber(Math.max(...values)),
      formatNumber(total / values.length),
    ]);
  }
  return { header: ['column', 'count', 'min', 'max', 'mean'], rows };
}
