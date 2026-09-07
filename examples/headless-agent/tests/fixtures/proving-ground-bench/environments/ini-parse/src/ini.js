/**
 * INI reader and writer with quoted tokens, escape sequences and a configurable
 * duplicate-key policy. Parsing and serialising must be exact inverses for every
 * document this module can produce.
 */

/** Failure raised by {@link parse} and {@link stringify}. */
export class IniError extends Error {
  /**
   * @param {string} message reason, without positional information
   * @param {number} [line] 1-based line number the failure was found on
   */
  constructor(message, line) {
    super(message);
    this.name = 'IniError';
    this.line = line;
  }
}

/**
 * Parse an INI document.
 *
 * @param {string} text document source
 * @param {{ duplicates?: 'last' | 'first' | 'error' | 'array' }} [options] duplicate-key policy
 * @returns {{ global: Record<string, string | string[]>, sections: Record<string, Record<string, string | string[]>> }}
 *   keys seen before the first header, and one body per section header
 */
export function parse(text, options = {}) {
  throw new Error('not implemented');
}

/**
 * Serialise one value as it would appear to the right of `=`.
 *
 * @param {string} value value text
 * @returns {string} quoted token when quoting is required, otherwise the value itself
 */
export function formatValue(value) {
  throw new Error('not implemented');
}

/**
 * Serialise one key as it would appear to the left of `=`.
 *
 * @param {string} key key text
 * @returns {string} quoted token when quoting is required, otherwise the key itself
 */
export function formatKey(key) {
  throw new Error('not implemented');
}

/**
 * Serialise a parsed document back to INI text.
 *
 * @param {{ global?: Record<string, string | string[]>, sections?: Record<string, Record<string, string | string[]>> }} data
 *   document to write
 * @param {{ eol?: string }} [options] line terminator, `'\n'` by default
 * @returns {string} INI text, empty when the document has no entries
 */
export function stringify(data, options = {}) {
  throw new Error('not implemented');
}
