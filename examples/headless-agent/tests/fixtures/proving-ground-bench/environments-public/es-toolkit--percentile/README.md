# Implement percentile from es-toolkit

`src/math/percentile.js` is the JavaScript build of `src/math/percentile.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `percentile`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Calculates the value at the given percentile of an array of numbers.
 *
 * Sorts the array in ascending order and returns the element at the nearest rank.
 * See {@link https://en.wikipedia.org/wiki/Percentile#The_nearest-rank_method | Nearest rank method}.
 *
 * `NaN` values are sorted as the smallest values. Returns `NaN` if the array is empty.
 *
 * @param arr - An array of numbers to calculate the percentile.
 * @param percentile - The percentile to compute, in the range `[0, 100]`.
 * @returns The value at the given percentile.
 * @throws {Error} Throws an error if `percentile` is not a number, less than `0`, or greater than `100`.
 *
 * @example
 * percentile([1, 2, 3, 4, 5], 50);
 * // Returns 3
 *
 * @example
 * percentile([1, 2, 3, 4, 5], 75);
 * // Returns 4
 *
 * @example
 * percentile([5, 1, 4, 2, 3], 0);
 * // Returns 1
 */
export function percentile(arr: readonly number[], percentile: number): number

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/math/percentile.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
