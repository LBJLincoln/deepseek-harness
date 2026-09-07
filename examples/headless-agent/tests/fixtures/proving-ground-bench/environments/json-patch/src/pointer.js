/** JSON Pointer parsing, formatting and resolution over JSON data. */

/** Failure raised while parsing or resolving a pointer. */
export class PointerError extends Error {
  /**
   * @param {string} message reason, including the pointer position when known
   * @param {unknown} [pointer] the pointer the failure came from
   */
  constructor(message, pointer) {
    super(message);
    this.name = 'PointerError';
    this.pointer = pointer;
  }
}

/**
 * Split a pointer into decoded reference tokens.
 *
 * @param {string} pointer JSON Pointer text
 * @returns {string[]} the decoded tokens, empty for the whole-document pointer
 */
export function parsePointer(pointer) {
  throw new Error('not implemented');
}

/**
 * Join reference tokens into a pointer.
 *
 * @param {string[]} tokens reference tokens
 * @returns {string} the pointer text, empty for no tokens
 */
export function formatPointer(tokens) {
  throw new Error('not implemented');
}

/**
 * Resolve a pointer against a document.
 *
 * @param {unknown} document JSON data to walk
 * @param {string} pointer JSON Pointer text
 * @returns {unknown} the value the pointer selects
 */
export function resolve(document, pointer) {
  if (pointer === '') return document;
  throw new Error('not implemented');
}
