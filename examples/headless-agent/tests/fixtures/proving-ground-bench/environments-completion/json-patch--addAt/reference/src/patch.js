/** JSON Patch application with all-or-nothing semantics. */

import { PointerError, arrayIndex, describe, formatPointer, isObject, parsePointer, resolve, setOwn } from './pointer.js';

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

const OPERATIONS = new Set(['add', 'remove', 'replace', 'move', 'copy', 'test']);

/**
 * Copy JSON data so the result shares nothing with its source.
 *
 * @param {unknown} value data to copy
 * @param {string} label noun used when the data is not JSON
 * @param {number} [index] operation index for the failure
 * @returns {unknown} an independent copy
 */
function clone(value, label, index) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return value;
  if (Array.isArray(value)) return value.map((item) => clone(item, label, index));
  if (isObject(value)) {
    const copy = {};
    for (const key of Object.keys(value)) setOwn(copy, key, clone(value[key], label, index));
    return copy;
  }
  throw new PatchError(`${label} is not JSON data`, index);
}

/**
 * Compare two JSON values structurally, ignoring member order.
 *
 * @param {unknown} a first value
 * @param {unknown} b second value
 * @returns {boolean} whether the values are equal as JSON
 */
export function jsonEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => jsonEqual(item, b[index]));
  }
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]));
  }
  return false;
}

/**
 * Resolve a pointer, reporting failures as patch failures.
 *
 * @param {unknown} document document to walk
 * @param {string} pointer pointer text
 * @param {number} index operation index for the failure
 * @returns {unknown} the selected value
 */
function locate(document, pointer, index) {
  try {
    return resolve(document, pointer);
  } catch (error) {
    if (error instanceof PointerError) throw new PatchError(error.message, index, { cause: error });
    throw error;
  }
}

/**
 * Insert a value, splicing into arrays and defining object members.
 *
 * @param {unknown} root current document root
 * @param {string[]} tokens pointer tokens of the target
 * @param {unknown} value value to insert
 * @param {number} index operation index for the failure
 * @returns {unknown} the new document root
 */
function addAt(root, tokens, value, index) {
  if (tokens.length === 0) return value;
  const parent = locate(root, formatPointer(tokens.slice(0, -1)), index);
  const key = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    const at = key === '-' ? parent.length : arrayIndex(key);
    if (at === null) throw new PatchError(`invalid array index: ${key}`, index);
    if (at > parent.length) throw new PatchError(`index out of range: ${key}`, index);
    parent.splice(at, 0, value);
    return root;
  }
  if (isObject(parent)) {
    setOwn(parent, key, value);
    return root;
  }
  throw new PatchError(`cannot index into ${describe(parent)}`, index);
}

/**
 * Delete an existing member or element.
 *
 * @param {unknown} root current document root
 * @param {string[]} tokens pointer tokens of the target
 * @param {number} index operation index for the failure
 * @returns {unknown} the new document root
 */
function removeAt(root, tokens, index) {
  if (tokens.length === 0) throw new PatchError('cannot remove the whole document', index);
  const parent = locate(root, formatPointer(tokens.slice(0, -1)), index);
  const key = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    const at = arrayIndex(key);
    if (at === null) throw new PatchError(`invalid array index: ${key}`, index);
    if (at >= parent.length) throw new PatchError(`index out of range: ${key}`, index);
    parent.splice(at, 1);
    return root;
  }
  if (isObject(parent)) {
    if (!Object.hasOwn(parent, key)) throw new PatchError(`missing property: ${key}`, index);
    delete parent[key];
    return root;
  }
  throw new PatchError(`cannot index into ${describe(parent)}`, index);
}

/**
 * Overwrite an existing member or element.
 *
 * @param {unknown} root current document root
 * @param {string[]} tokens pointer tokens of the target
 * @param {unknown} value replacement value
 * @param {number} index operation index for the failure
 * @returns {unknown} the new document root
 */
function replaceAt(root, tokens, value, index) {
  if (tokens.length === 0) return value;
  const parent = locate(root, formatPointer(tokens.slice(0, -1)), index);
  const key = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    const at = arrayIndex(key);
    if (at === null) throw new PatchError(`invalid array index: ${key}`, index);
    if (at >= parent.length) throw new PatchError(`index out of range: ${key}`, index);
    parent[at] = value;
    return root;
  }
  if (isObject(parent)) {
    if (!Object.hasOwn(parent, key)) throw new PatchError(`missing property: ${key}`, index);
    setOwn(parent, key, value);
    return root;
  }
  throw new PatchError(`cannot index into ${describe(parent)}`, index);
}

/**
 * Read the required members of one operation.
 *
 * @param {unknown} operation operation object
 * @param {number} index operation index for the failure
 * @returns {{ op: string, path: string, from?: string, value?: unknown }} the checked members
 */
function checkOperation(operation, index) {
  if (!isObject(operation)) throw new PatchError('operation must be an object', index);
  const { op } = operation;
  if (typeof op !== 'string' || !OPERATIONS.has(op)) throw new PatchError(`unknown operation: ${String(op)}`, index);
  if (!Object.hasOwn(operation, 'path')) throw new PatchError(`${op} requires a path`, index);
  if ((op === 'add' || op === 'replace' || op === 'test') && !Object.hasOwn(operation, 'value')) {
    throw new PatchError(`${op} requires a value`, index);
  }
  if ((op === 'move' || op === 'copy') && !Object.hasOwn(operation, 'from')) {
    throw new PatchError(`${op} requires a from`, index);
  }
  return operation;
}

/**
 * Whether one token list is a proper prefix of another.
 *
 * @param {string[]} prefix candidate prefix
 * @param {string[]} tokens token list to test
 * @returns {boolean} true when `prefix` is shorter and matches element-wise
 */
function isProperPrefix(prefix, tokens) {
  return prefix.length < tokens.length && prefix.every((token, index) => token === tokens[index]);
}

/**
 * Apply one operation to the working document.
 *
 * @param {unknown} root current document root
 * @param {object} operation operation to apply
 * @param {number} index 0-based operation index
 * @returns {unknown} the new document root
 */
function applyOne(root, operation, index) {
  const { op, path } = checkOperation(operation, index);
  let tokens;
  try {
    tokens = parsePointer(path);
  } catch (error) {
    throw new PatchError(error.message, index, { cause: error });
  }

  if (op === 'add') return addAt(root, tokens, clone(operation.value, 'value', index), index);
  if (op === 'remove') return removeAt(root, tokens, index);
  if (op === 'replace') return replaceAt(root, tokens, clone(operation.value, 'value', index), index);
  if (op === 'test') {
    const actual = locate(root, path, index);
    if (!jsonEqual(actual, operation.value)) throw new PatchError(`test failed at ${path}`, index);
    return root;
  }

  let from;
  try {
    from = parsePointer(operation.from);
  } catch (error) {
    throw new PatchError(error.message, index, { cause: error });
  }
  const value = locate(root, operation.from, index);
  if (op === 'copy') return addAt(root, tokens, clone(value, 'value', index), index);
  if (from.length === tokens.length && from.every((token, at) => token === tokens[at])) return root;
  if (isProperPrefix(from, tokens)) throw new PatchError('cannot move a value into its own child', index);
  return addAt(removeAt(root, from, index), tokens, value, index);
}

/**
 * Apply a patch, leaving the input untouched whether or not it succeeds.
 *
 * @param {unknown} document JSON data to patch
 * @param {object[]} operations the patch
 * @returns {unknown} a new document with every operation applied
 */
export function applyPatch(document, operations) {
  if (!Array.isArray(operations)) throw new PatchError('patch must be an array');
  let root = clone(document, 'document');
  for (let index = 0; index < operations.length; index += 1) root = applyOne(root, operations[index], index);
  return root;
}
