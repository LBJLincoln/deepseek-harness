# Implement median from es-toolkit

`src/math/median.js` is the JavaScript build of `src/math/median.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `median`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Calculates the median of an array of numbers.
 *
 * The median is the middle value of a sorted array.
 * If the array has an odd number of elements, the median is the middle value.
 * If the array has an even number of elements, it returns the average of the two middle values.
 *
 * If the array is empty, this function returns `NaN`.
 *
 * @param nums - An array of numbers to calculate the median.
 * @returns The median of all the numbers in the array.
 *
 * @example
 * const arrayWithOddNumberOfElements = [1, 2, 3, 4, 5];
 * const result = median(arrayWithOddNumberOfElements);
 * // result will be 3
 *
 * @example
 * const arrayWithEvenNumberOfElements = [1, 2, 3, 4];
 * const result = median(arrayWithEvenNumberOfElements);
 * // result will be 2.5
 */
export function median(nums: readonly number[]): number

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/math/median.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
