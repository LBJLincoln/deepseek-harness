/** JSON Patch application with all-or-nothing semantics. */

import { PointerError, formatPointer, parsePointer, resolve } from './pointer.js';

/** Failure raised while applying a patch. */
export class PatchError extends Error {
  /**
   * @param {string} message reason
   * @param {number} [index] 0-based index of the operation that failed
   * @param {{ cause?: unknown }} [options] the underlying pointer failure, when there is one
   */
  constructor(message, index, options) {
    super(message, options);
    this.name = 'PatchError';
    this.index = index;
  }
}

/**
 * Apply a patch, leaving the input untouched whether or not it succeeds.
 *
 * @param {unknown} document JSON data to patch
 * @param {object[]} operations the patch
 * @returns {unknown} a new document with every operation applied
 */
export function applyPatch(document, operations) {
  throw new Error('not implemented');
}
