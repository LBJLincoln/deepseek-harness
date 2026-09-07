/**
 * RFC 4180 style CSV reader and writer with a configurable delimiter and quote
 * character, byte-order-mark handling and exact positions on failure.
 */

/** Failure raised by the CSV reader and writer. */
export class CsvError extends Error {
  /**
   * @param {string} message reason, without positional information
   * @param {number} [line] 1-based line the failure was found on
   * @param {number} [column] 1-based column, counted in UTF-16 code units
   */
  constructor(message, line, column) {
    super(message);
    this.name = 'CsvError';
    this.line = line;
    this.column = column;
  }
}

/**
 * Read a CSV document into records.
 *
 * @param {string} text document source
 * @param {{ delimiter?: string, quote?: string, strictWidth?: boolean }} [options] dialect and width policy
 * @returns {string[][]} one array of field values per record
 */
export function parse(text, options = {}) {
  throw new Error('not implemented');
}

/**
 * Serialise one field, quoting it when the dialect requires it.
 *
 * @param {unknown} value field value
 * @param {{ delimiter?: string, quote?: string, alwaysQuote?: boolean }} [options] dialect and quoting policy
 * @returns {string} the field as it appears in the document
 */
export function escapeField(value, options = {}) {
  throw new Error('not implemented');
}

/**
 * Write records as a CSV document.
 *
 * @param {unknown[][]} rows records to write
 * @param {{ delimiter?: string, quote?: string, newline?: string, bom?: boolean, alwaysQuote?: boolean }} [options]
 *   dialect, terminator and byte-order-mark policy
 * @returns {string} the document, with a terminator after every record
 */
export function stringify(rows, options = {}) {
  throw new Error('not implemented');
}
