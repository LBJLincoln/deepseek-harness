# Implement takeWhile from es-toolkit

`src/array/takeWhile.js` is the JavaScript build of `src/array/takeWhile.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `takeWhile`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Returns a new array containing the leading elements of the provided array
 * that satisfy the provided predicate function. It stops taking elements as soon
 * as an element does not satisfy the predicate.
 *
 * @template T - The type of elements in the array.
 * @param arr - The array to process.
 * @param shouldContinueTaking - The predicate function that is called with each element, its index, and the array. Elements are included in the result as long as this function returns true.
 * @returns A new array containing the leading elements that satisfy the predicate.
 *
 * @example
 * // Returns [1, 2]
 * takeWhile([1, 2, 3, 4], x => x < 3);
 *
 * @example
 * // Returns []
 * takeWhile([1, 2, 3, 4], x => x > 3);
 *
 * @example
 * // Using index parameter
 * takeWhile([10, 20, 30, 40], (x, index) => index < 2);
 * // Returns: [10, 20]
 */
export function takeWhile<T>(
  arr: readonly T[],
  shouldContinueTaking: (element: T, index: number, array: readonly T[]) => boolean
): T[]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/takeWhile.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
