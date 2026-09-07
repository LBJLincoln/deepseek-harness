/**
 * Fixed-width plain-text tables: display width, wrapping, padding and layout.
 */

/** Error raised for invalid table input. */
export class TableError extends Error {
  /**
   * @param {string} code Stable machine-readable reason.
   * @param {string} message Human-readable detail.
   */
  constructor(code, message) {
    super(message);
    this.name = 'TableError';
    this.code = code;
  }
}

/**
 * Display width of a string in terminal columns.
 *
 * @param {string} text Text to measure.
 * @returns {number} Column count.
 */
export function stringWidth(text) {
  throw new Error('not implemented');
}

/**
 * Wrap cell text to a column width.
 *
 * @param {string} text Cell text; explicit newlines start a new line.
 * @param {number} width Column width in display columns.
 * @returns {string[]} Wrapped lines, at least one.
 */
export function wrapCell(text, width) {
  throw new Error('not implemented');
}

/**
 * Pad a single line to an exact display width.
 *
 * @param {string} text Line that already fits.
 * @param {number} width Target column width.
 * @param {'left'|'right'|'center'} [align] Alignment, left by default.
 * @returns {string} Padded line.
 */
export function padCell(text, width, align = 'left') {
  throw new Error('not implemented');
}

/**
 * Render rows as a fixed-width table.
 *
 * @param {string[][]} rows Rows of cells.
 * @param {{widths: number[], align?: string[], header?: boolean}} options Layout options.
 * @returns {string} Table text without a trailing newline.
 */
export function formatTable(rows, options) {
  throw new Error('not implemented');
}
