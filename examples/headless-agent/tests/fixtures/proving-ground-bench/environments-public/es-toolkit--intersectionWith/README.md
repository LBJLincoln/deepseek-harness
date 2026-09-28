# Implement intersectionWith from es-toolkit

`src/array/intersectionWith.js` is the JavaScript build of `src/array/intersectionWith.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `intersectionWith`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Returns the intersection of two arrays based on a custom equality function.
 *
 * This function takes two arrays and a custom equality function. It returns a new array containing
 * the elements from the first array that have matching elements in the second array, as determined
 * by the custom equality function. It effectively filters out any elements from the first array that
 * do not have corresponding matches in the second array according to the equality function.
 *
 * @template T - The type of elements in the first array.
 * @template U - The type of elements in the second array.
 * @param firstArr - The first array to compare.
 * @param secondArr - The second array to compare.
 * @param areItemsEqual - A custom function to determine if two elements are equal.
 * This function takes two arguments, one from each array, and returns `true` if the elements are considered equal, and `false` otherwise.
 * @returns A new array containing the elements from the first array that have corresponding matches in the second array according to the custom equality function.
 *
 * @example
 * const array1 = [{ id: 1 }, { id: 2 }, { id: 3 }];
 * const array2 = [{ id: 2 }, { id: 4 }];
 * const areItemsEqual = (a, b) => a.id === b.id;
 * const result = intersectionWith(array1, array2, areItemsEqual);
 * // result will be [{ id: 2 }] since this element has a matching id in both arrays.
 *
 * @example
 * const array1 = [
 *   { id: 1, name: 'jane' },
 *   { id: 2, name: 'amy' },
 *   { id: 3, name: 'michael' },
 * ];
 * const array2 = [2, 4];
 * const areItemsEqual = (a, b) => a.id === b;
 * const result = intersectionWith(array1, array2, areItemsEqual);
 * // result will be [{ id: 2, name: 'amy' }] since this element has a matching id that is equal to seconds array's element.
 */
export function intersectionWith<T, U>(
  firstArr: readonly T[],
  secondArr: readonly U[],
  areItemsEqual: (x: T, y: U) => boolean
): T[]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/intersectionWith.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
