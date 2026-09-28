# Implement differenceWith from es-toolkit

`src/array/differenceWith.js` is the JavaScript build of `src/array/differenceWith.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `differenceWith`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Computes the difference between two arrays based on a custom equality function.
 *
 * This function takes two arrays and a custom comparison function. It returns a new array containing
 * the elements that are present in the first array but not in the second array. The comparison to determine
 * if elements are equal is made using the provided custom function.
 *
 * @template T, U
 * @param firstArr - The array from which to get the difference.
 * @param secondArr - The array containing elements to exclude from the first array.
 * @param areItemsEqual - A function to determine if two items are equal.
 * @returns A new array containing the elements from the first array that do not match any elements in the second array
 * according to the custom equality function.
 *
 * @example
 * const array1 = [{ id: 1 }, { id: 2 }, { id: 3 }];
 * const array2 = [{ id: 2 }, { id: 4 }];
 * const areItemsEqual = (a, b) => a.id === b.id;
 * const result = differenceWith(array1, array2, areItemsEqual);
 * // result will be [{ id: 1 }, { id: 3 }] since the elements with id 2 are considered equal and are excluded from the result.
 *
 * @example
 * const array1 = [{ id: 1 }, { id: 2 }, { id: 3 }];
 * const array2 = [2, 4];
 * const areItemsEqual = (a, b) => a.id === b;
 * const result = differenceWith(array1, array2, areItemsEqual);
 * // result will be [{ id: 1 }, { id: 3 }] since the element with id 2 is considered equal to the second array's element and is excluded from the result.
 */
export function differenceWith<T, U>(
  firstArr: readonly T[],
  secondArr: readonly U[],
  areItemsEqual: (x: T, y: U) => boolean
): T[]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/differenceWith.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
