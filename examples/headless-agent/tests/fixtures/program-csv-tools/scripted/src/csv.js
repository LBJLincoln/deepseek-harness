/**
 * The RFC 4180 subset reader and writer csv-tools is built on, owned by the
 * department that also delivers `stats`.
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
 * Split a document into records without interpreting the first one.
 *
 * @param {string} text document source
 * @returns {string[][]} one array of field values per record
 */
function readRecords(text) {
  const records = [];
  let record = [];
  let field = '';
  let inQuotes = false;
  let quotedField = false;
  let closed = false;
  let open = false;
  let index = 0;
  const endField = () => {
    record.push(field);
    field = '';
    quotedField = false;
    closed = false;
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
    open = false;
  };
  while (index < text.length) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        closed = true;
        index += 1;
        continue;
      }
      field += character;
      index += 1;
      continue;
    }
    if (character === '\r' || character === '\n') {
      endRecord();
      index += character === '\r' && text[index + 1] === '\n' ? 2 : 1;
      continue;
    }
    open = true;
    if (character === ',') {
      endField();
      index += 1;
      continue;
    }
    if (character === '"' && field === '' && !quotedField) {
      quotedField = true;
      inQuotes = true;
      index += 1;
      continue;
    }
    if (closed) throw dataError(`unexpected character after closing quote: ${character}`);
    field += character;
    index += 1;
  }
  if (inQuotes) throw dataError('unterminated quoted field');
  if (open) endRecord();
  return records;
}

/**
 * Read a document into a header and its data rows.
 *
 * @param {string} text document source
 * @returns {{ header: string[], rows: string[][] }} the table the document holds
 */
export function parseCsv(text) {
  const records = readRecords(text);
  const header = records.shift();
  if (header === undefined) throw dataError('input has no header record');
  const seen = new Set();
  for (const name of header) {
    if (seen.has(name)) throw dataError(`duplicate column: ${name}`);
    seen.add(name);
  }
  for (const [offset, row] of records.entries()) {
    if (row.length !== header.length) {
      throw dataError(`row ${offset + 1}: expected ${header.length} fields, got ${row.length}`);
    }
  }
  return { header, rows: records };
}

/**
 * Write one field, quoting it when the dialect requires it.
 *
 * @param {string} value field value
 * @returns {string} the field as it appears in a document
 */
export function escapeField(value) {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * Write a table as a document, one LF after every record.
 *
 * @param {{ header: string[], rows: string[][] }} table the table to write
 * @returns {string} the document
 */
export function formatCsv(table) {
  return [table.header, ...table.rows]
    .map(record => `${record.map(escapeField).join(',')}\n`)
    .join('');
}
