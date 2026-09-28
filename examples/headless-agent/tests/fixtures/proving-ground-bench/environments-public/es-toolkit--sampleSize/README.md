# Implement sampleSize from es-toolkit

`src/array/sampleSize.js` is the JavaScript build of `src/array/sampleSize.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `sampleSize`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Returns a sample element array of a specified `size`.
 *
 * This function takes an array and a number, and returns an array containing the sampled elements using Floyd's algorithm.
 *
 * {@link https://www.nowherenearithaca.com/2013/05/robert-floyds-tiny-and-beautiful.html Floyd's algorithm}
 *
 * @template T - The type of elements in the array.
 * @param array - The array to sample from.
 * @param size - The size of sample.
 * @returns A new array with sample size applied.
 * @throws {Error} Throws an error if `size` is greater than the length of `array`.
 *
 * @example
 * const result = sampleSize([1, 2, 3], 2)
 * // result will be an array containing two of the elements from the array.
 * // [1, 2] or [1, 3] or [2, 3]
 */
export function sampleSize<T>(array: readonly T[], size: number): T[]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/math/random.js`, `src/math/randomInt.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/sampleSize.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
