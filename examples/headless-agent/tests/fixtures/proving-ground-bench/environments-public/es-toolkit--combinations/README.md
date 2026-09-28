# Implement combinations from es-toolkit

`src/array/combinations.js` is the JavaScript build of `src/array/combinations.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `combinations`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Returns all `r`-length combinations of elements from the input array.
 *
 * Combinations are emitted in lexicographic order based on the position of elements in the input array.
 * Elements are treated as unique by position, not by value, so duplicates in the input may produce
 * combinations that look identical.
 *
 * The number of combinations is `n! / r! / (n - r)!` when `0 <= r <= n`, and zero when `r > n`.
 *
 * @template T
 * @param arr - The input array.
 * @param r - The length of each combination. Must be a non-negative integer.
 * @returns An array of `r`-length combinations.
 * @throws {Error} If `r` is not a non-negative integer.
 *
 * @example
 * combinations(['A', 'B', 'C', 'D'], 2);
 * // => [['A','B'], ['A','C'], ['A','D'], ['B','C'], ['B','D'], ['C','D']]
 *
 * @example
 * combinations([1, 2, 3, 4], 3);
 * // => [[1,2,3], [1,2,4], [1,3,4], [2,3,4]]
 *
 * @example
 * combinations([1, 2, 3], 0);
 * // => [[]]
 *
 * @example
 * combinations([1, 2], 5);
 * // => []
 */
export function combinations<T>(arr: readonly T[], r: number): T[][]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/combinations.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
