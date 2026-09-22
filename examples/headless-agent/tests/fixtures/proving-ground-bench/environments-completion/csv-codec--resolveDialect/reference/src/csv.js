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

const BOM = '﻿';

/**
 * Validate and default the delimiter and quote characters.
 *
 * @param {{ delimiter?: string, quote?: string }} options caller options
 * @returns {{ delimiter: string, quote: string }} the two separator characters
 */
function resolveDialect(options) {
  const delimiter = options.delimiter ?? ',';
  const quote = options.quote ?? '"';
  if (typeof delimiter !== 'string' || delimiter.length !== 1) throw new CsvError('delimiter must be a single character');
  if (typeof quote !== 'string' || quote.length !== 1) throw new CsvError('quote must be a single character');
  if (delimiter === quote) throw new CsvError('delimiter and quote must differ');
  if ('\r\n'.includes(delimiter) || '\r\n'.includes(quote)) throw new CsvError('delimiter and quote must not be line terminators');
  return { delimiter, quote };
}

/**
 * Read a CSV document into records.
 *
 * @param {string} text document source
 * @param {{ delimiter?: string, quote?: string, strictWidth?: boolean }} [options] dialect and width policy
 * @returns {string[][]} one array of field values per record
 */
export function parse(text, options = {}) {
  if (typeof text !== 'string') throw new CsvError('input must be a string');
  const { delimiter, quote } = resolveDialect(options);
  const strictWidth = options.strictWidth === true;

  let i = text.startsWith(BOM) ? BOM.length : 0;
  if (i >= text.length) return [];

  const rows = [];
  let row = [];
  let line = 1;
  let lineStart = i;
  let recordLine = 1;

  /**
   * Append the finished record and enforce the width policy.
   *
   * @returns {void}
   */
  const pushRow = () => {
    if (strictWidth && rows.length > 0 && row.length !== rows[0].length) {
      throw new CsvError(`expected ${rows[0].length} fields, got ${row.length}`, recordLine);
    }
    rows.push(row);
    row = [];
  };

  for (;;) {
    let field = '';
    if (text[i] === quote) {
      const openLine = line;
      const openColumn = i - lineStart + 1;
      i += 1;
      let closed = false;
      while (i < text.length) {
        const ch = text[i];
        if (ch === quote) {
          if (text[i + 1] === quote) {
            field += quote;
            i += 2;
            continue;
          }
          i += 1;
          closed = true;
          break;
        }
        field += ch;
        i += 1;
        if (ch === '\n' || (ch === '\r' && text[i] !== '\n')) {
          line += 1;
          lineStart = i;
        }
      }
      if (!closed) throw new CsvError('unterminated quoted field', openLine, openColumn);
      const after = text[i];
      if (after !== undefined && after !== delimiter && after !== '\n' && after !== '\r') {
        throw new CsvError(`unexpected character after closing quote: ${after}`, line, i - lineStart + 1);
      }
    } else {
      while (i < text.length) {
        const ch = text[i];
        if (ch === delimiter || ch === '\n' || ch === '\r') break;
        field += ch;
        i += 1;
      }
    }

    row.push(field);
    if (i >= text.length) {
      pushRow();
      break;
    }
    if (text[i] === delimiter) {
      i += 1;
      continue;
    }
    i += text[i] === '\r' && text[i + 1] === '\n' ? 2 : 1;
    line += 1;
    lineStart = i;
    pushRow();
    recordLine = line;
    if (i >= text.length) break;
  }
  return rows;
}

/**
 * Convert one field value to the text that will be written.
 *
 * @param {unknown} value field value
 * @returns {string} the field's text
 */
function fieldText(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CsvError(`unsupported field value: ${value}`);
    return String(value);
  }
  throw new CsvError(`unsupported field type: ${typeof value}`);
}

/**
 * Serialise one field, quoting it when the dialect requires it.
 *
 * @param {unknown} value field value
 * @param {{ delimiter?: string, quote?: string, alwaysQuote?: boolean }} [options] dialect and quoting policy
 * @returns {string} the field as it appears in the document
 */
export function escapeField(value, options = {}) {
  const { delimiter, quote } = resolveDialect(options);
  const text = fieldText(value);
  const needed =
    options.alwaysQuote === true ||
    text.includes(delimiter) ||
    text.includes(quote) ||
    text.includes('\n') ||
    text.includes('\r') ||
    text.includes(BOM);
  if (!needed) return text;
  return quote + text.split(quote).join(quote + quote) + quote;
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
  const { delimiter } = resolveDialect(options);
  const newline = options.newline ?? '\r\n';
  if (newline !== '\r\n' && newline !== '\n' && newline !== '\r') throw new CsvError('newline must be a line terminator');
  if (!Array.isArray(rows)) throw new CsvError('rows must be an array');

  let out = options.bom === true ? BOM : '';
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!Array.isArray(row)) throw new CsvError(`record ${index} is not an array`);
    if (row.length === 0) throw new CsvError(`record ${index} has no fields`);
    const fields = [];
    for (const value of row) fields.push(escapeField(value, options));
    out += fields.join(delimiter) + newline;
  }
  return out;
}
