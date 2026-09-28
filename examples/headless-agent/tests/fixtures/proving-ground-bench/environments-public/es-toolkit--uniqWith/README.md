# Implement uniqWith from es-toolkit

`src/array/uniqWith.js` is the JavaScript build of `src/array/uniqWith.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `uniqWith`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Returns a new array containing only the unique elements from the original array,
 * based on the values returned by the comparator function.
 *
 * @template T - The type of elements in the array.
 * @param arr - The array to process.
 * @param areItemsEqual - The function used to compare the array elements.
 * @returns A new array containing only the unique elements from the original array, based on the values returned by the comparator function.
 *
 * @example
 * ```ts
 * uniqWith([1.2, 1.5, 2.1, 3.2, 5.7, 5.3, 7.19], (a, b) => Math.abs(a - b) < 1);
 * // [1.2, 3.2, 5.7, 7.19]
 * ```
 */
export function uniqWith<T>(arr: readonly T[], areItemsEqual: (item1: T, item2: T) => boolean): T[]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/uniqWith.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
