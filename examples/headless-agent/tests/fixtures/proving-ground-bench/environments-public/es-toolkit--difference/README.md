# Implement difference from es-toolkit

`src/array/difference.js` is the JavaScript build of `src/array/difference.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `difference`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Computes the difference between two arrays.
 *
 * This function takes two arrays and returns a new array containing the elements
 * that are present in the first array but not in the second array. It effectively
 * filters out any elements from the first array that also appear in the second array.
 *
 * @template T
 * @param firstArr - The array from which to derive the difference. This is the primary array
 * from which elements will be compared and filtered.
 * @param secondArr - The array containing elements to be excluded from the first array.
 * Each element in this array will be checked against the first array, and if a match is found,
 * that element will be excluded from the result.
 * @returns A new array containing the elements that are present in the first array but not
 * in the second array.
 *
 * @example
 * const array1 = [1, 2, 3, 4, 5];
 * const array2 = [2, 4];
 * const result = difference(array1, array2);
 * // result will be [1, 3, 5] since 2 and 4 are in both arrays and are excluded from the result.
 */
export function difference<T>(firstArr: readonly T[], secondArr: readonly T[]): T[]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/difference.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
