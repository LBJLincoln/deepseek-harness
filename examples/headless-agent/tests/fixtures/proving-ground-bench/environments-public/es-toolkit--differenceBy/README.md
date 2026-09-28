# Implement differenceBy from es-toolkit

`src/array/differenceBy.js` is the JavaScript build of `src/array/differenceBy.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `differenceBy`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Computes the difference between two arrays after mapping their elements through a provided function.
 *
 * This function takes two arrays and a mapper function. It returns a new array containing the elements
 * that are present in the first array but not in the second array, based on the identity calculated
 * by the mapper function.
 *
 * Essentially, it filters out any elements from the first array that, when
 * mapped, match an element in the mapped version of the second array.
 *
 * @template T, U
 * @param firstArr - The primary array from which to derive the difference.
 * @param secondArr - The array containing elements to be excluded from the first array.
 * @param mapper - The function to map the elements of both arrays. This function
 * is applied to each element in both arrays, and the comparison is made based on the mapped values.
 * @returns A new array containing the elements from the first array that do not have a corresponding
 * mapped identity in the second array.
 *
 * @example
 * const array1 = [{ id: 1 }, { id: 2 }, { id: 3 }];
 * const array2 = [{ id: 2 }, { id: 4 }];
 * const mapper = item => item.id;
 * const result = differenceBy(array1, array2, mapper);
 * // result will be [{ id: 1 }, { id: 3 }] since the elements with id 2 are in both arrays and are excluded from the result.
 *
 * @example
 * const array1 = [{ id: 1 }, { id: 2 }, { id: 3 }];
 * const array2 = [2, 4];
 * const mapper = item => (typeof item === 'object' ? item.id : item);
 * const result = differenceBy(array1, array2, mapper);
 * // result will be [{ id: 1 }, { id: 3 }] since 2 is present in both arrays after mapping, and is excluded from the result.
 */
export function differenceBy<T, U>(
  firstArr: readonly T[],
  secondArr: readonly U[],
  mapper: (value: T | U) => unknown
): T[]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/differenceBy.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
