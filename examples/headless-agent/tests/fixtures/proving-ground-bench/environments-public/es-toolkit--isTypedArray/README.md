# Implement isTypedArray from es-toolkit

`src/predicate/isTypedArray.js` is the JavaScript build of `src/predicate/isTypedArray.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `isTypedArray`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Checks if a value is a TypedArray.
 * @param x The value to check.
 * @returns Returns true if `x` is a TypedArray, false otherwise.
 *
 * @example
 * const arr = new Uint8Array([1, 2, 3]);
 * isTypedArray(arr); // true
 *
 * const regularArray = [1, 2, 3];
 * isTypedArray(regularArray); // false
 *
 * const buffer = new ArrayBuffer(16);
 * isTypedArray(buffer); // false
 */
export function isTypedArray(
  x: unknown
): x is
  | Uint8Array
  | Uint8ClampedArray
  | Uint16Array
  | Uint32Array
  | BigUint64Array
  | Int8Array
  | Int16Array
  | Int32Array
  | BigInt64Array
  | Float32Array
  | Float64Array

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/predicate/isTypedArray.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
