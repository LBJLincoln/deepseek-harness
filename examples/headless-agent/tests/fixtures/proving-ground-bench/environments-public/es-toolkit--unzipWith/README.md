# Implement unzipWith from es-toolkit

`src/array/unzipWith.js` is the JavaScript build of `src/array/unzipWith.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `unzipWith`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Unzips an array of arrays, applying an `iteratee` function to regrouped elements.
 *
 * @template T, R
 * @param target - The nested array to unzip. This is an array of arrays,
 * where each inner array contains elements to be unzipped.
 * @param iteratee - A function to transform the unzipped elements.
 * @returns A new array of unzipped and transformed elements.
 *
 * @example
 * const nestedArray = [[1, 2], [3, 4], [5, 6]];
 * const result = unzipWith(nestedArray, (item, item2, item3) => item + item2 + item3);
 * // result will be [9, 12]
 */
export function unzipWith<T, R>(target: readonly T[][], iteratee: (...args: T[]) => R): R[]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/array/zip.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/unzipWith.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
