# Implement unionWith from es-toolkit

`src/array/unionWith.js` is the JavaScript build of `src/array/unionWith.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `unionWith`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates an array of unique values from two given arrays based on a custom equality function.
 *
 * This function takes two arrays and a custom equality function, merges the arrays, and returns
 * a new array containing only the unique values as determined by the custom equality function.
 *
 * @template T - The type of elements in the array.
 * @param arr1 - The first array to merge and filter for unique values.
 * @param arr2 - The second array to merge and filter for unique values.
 * @param areItemsEqual - A custom function to determine if two elements are equal.
 * It takes two arguments and returns `true` if the elements are considered equal, and `false` otherwise.
 * @returns A new array of unique values based on the custom equality function.
 *
 * @example
 * const array1 = [{ id: 1 }, { id: 2 }];
 * const array2 = [{ id: 2 }, { id: 3 }];
 * const areItemsEqual = (a, b) => a.id === b.id;
 * const result = unionWith(array1, array2, areItemsEqual);
 * // result will be [{ id: 1 }, { id: 2 }, { id: 3 }] since { id: 2 } is considered equal in both arrays
 */
export function unionWith<T>(
  arr1: readonly T[],
  arr2: readonly T[],
  areItemsEqual: (item1: T, item2: T) => boolean
): T[]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/array/uniqWith.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/unionWith.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
