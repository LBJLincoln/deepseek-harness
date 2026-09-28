# Implement zipWith from es-toolkit

`src/array/zipWith.js` is the JavaScript build of `src/array/zipWith.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `zipWith`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Combines multiple arrays into a single array using a custom combiner function.
 *
 * This function takes one array and a variable number of additional arrays,
 * applying the provided combiner function to the corresponding elements of each array.
 * If the input arrays are of different lengths, the resulting array will have the length
 * of the longest input array, with undefined values for missing elements.
 *
 * @template T - The type of elements in the input arrays.
 * @template R - The type of elements in the resulting array.
 * @param arr1 - The first array to zip.
 * @param rest - The additional arrays to zip together, followed by the combiner function.
 * @param combine - The combiner function that takes corresponding elements from each array, followed by their index, and returns a single value.
 * @returns A new array where each element is the result of applying the combiner function to the corresponding elements of the input arrays.
 *
 * @example
 * const arr1 = [1, 2, 3];
 * const arr2 = ['a', 'b', 'c'];
 * const result = zipWith(arr1, arr2, (num, char) => `${num}${char}`);
 * // result will be ['1a', '2b', '3c']
 */
export function zipWith<T, R>(arr1: readonly T[], ...rest: any[]): R[]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/zipWith.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
