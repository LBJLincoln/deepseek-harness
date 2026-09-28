# Implement zipObject from es-toolkit

`src/array/zipObject.js` is the JavaScript build of `src/array/zipObject.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `zipObject`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Combines two arrays, one of property names and one of corresponding values, into a single object.
 *
 * This function takes two arrays: one containing property names and another containing corresponding values.
 * It returns a new object where the property names from the first array are keys, and the corresponding elements
 * from the second array are values. If the `keys` array is longer than the `values` array, the remaining keys will
 * have `undefined` as their values.
 *
 * @template P - The type of elements in the array.
 * @template V - The type of elements in the array.
 * @param keys - An array of property names.
 * @param values - An array of values corresponding to the property names.
 * @returns A new object composed of the given property names and values.
 *
 * @example
 * const keys = ['a', 'b', 'c'];
 * const values = [1, 2, 3];
 * const result = zipObject(keys, values);
 * // result will be { a: 1, b: 2, c: 3 }
 *
 * const keys2 = ['a', 'b', 'c'];
 * const values2 = [1, 2];
 * const result2 = zipObject(keys2, values2);
 * // result2 will be { a: 1, b: 2, c: undefined }
 *
 * const keys2 = ['a', 'b'];
 * const values2 = [1, 2, 3];
 * const result2 = zipObject(keys2, values2);
 * // result2 will be { a: 1, b: 2 }
 */
export function zipObject<P extends PropertyKey, V>(keys: readonly P[], values: readonly V[]): Record<P, V>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/zipObject.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
