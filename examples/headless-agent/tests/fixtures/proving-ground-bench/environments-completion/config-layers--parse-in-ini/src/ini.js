/** The INI reader: dotted keys, the raw text of each value, and where that text sits. */

const NAME = /^[A-Za-z0-9_.-]+$/

/** One refusal of an INI line, carrying the 1-based line and column it was read at. */
export class IniError extends Error {
  /**
   * @param {number} line - the 1-based input line.
   * @param {number} column - the 1-based column of the raw line.
   * @param {string} message - the message the specification words, without the position.
   */
  constructor(line, column, message) {
    super(message)
    this.name = 'IniError'
    this.line = line
    this.column = column
  }
}

/** The 1-based column of the first non-space character of `raw`. */
function indent(raw) {
  return raw.length - raw.trimStart().length + 1
}

/**
 * Parse INI text into its settings.
 * @param {string} text - the file's whole text.
 * @returns {Map<string, {text: string, line: number, column: number}>} each dotted key's raw value and position, in the order the file writes them.
 * @throws {IniError} on the first line the grammar refuses.
 */
export function parse(text) {
  throw new Error('not implemented')
}
