# Implement union from es-toolkit

`src/array/union.js` is the JavaScript build of `src/array/union.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `union`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates an array of unique values from all given arrays.
 *
 * This function takes two arrays, merges them into a single array, and returns a new array
 * containing only the unique values from the merged array.
 *
 * @template T - The type of elements in the array.
 * @param arr1 - The first array to merge and filter for unique values.
 * @param arr2 - The second array to merge and filter for unique values.
 * @returns A new array of unique values.
 *
 * @example
 * const array1 = [1, 2, 3];
 * const array2 = [3, 4, 5];
 * const result = union(array1, array2);
 * // result will be [1, 2, 3, 4, 5]
 */
export function union<T>(arr1: readonly T[], arr2: readonly T[]): T[]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/array/uniq.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/union.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
