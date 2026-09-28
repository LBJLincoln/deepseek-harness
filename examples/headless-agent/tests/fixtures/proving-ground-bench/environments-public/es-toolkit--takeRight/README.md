# Implement takeRight from es-toolkit

`src/array/takeRight.js` is the JavaScript build of `src/array/takeRight.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `takeRight`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Returns a new array containing the last `count` elements from the input array `arr`.
 * If `count` is greater than the length of `arr`, the entire array is returned.
 *
 * @template T - The type of elements in the array.
 * @param arr - The array to take elements from.
 * @param count - The number of elements to take.
 * @returns A new array containing the last `count` elements from `arr`.
 *
 * @example
 * // Returns [4, 5]
 * takeRight([1, 2, 3, 4, 5], 2);
 *
 * @example
 * // Returns ['b', 'c']
 * takeRight(['a', 'b', 'c'], 2);
 *
 * @example
 * // Returns [1, 2, 3]
 * takeRight([1, 2, 3], 5);
 */
export function takeRight<T>(arr: readonly T[], count: number): T[]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/takeRight.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
