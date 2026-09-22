/**
 * JSON Pointer resolution and JSON Patch application: pointers with `~`
 * escapes, the six patch operations, and a patch that either applies whole or
 * leaves the input alone.
 */

export { PointerError, formatPointer, parsePointer, resolve } from './pointer.js';
export { PatchError, applyPatch } from './patch.js';
