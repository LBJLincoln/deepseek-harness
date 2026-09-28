# Implement xor from es-toolkit

`src/array/xor.js` is the JavaScript build of `src/array/xor.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `xor`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Computes the symmetric difference between two arrays. The symmetric difference is the set of elements
 * which are in either of the arrays, but not in their intersection.
 *
 * @template T - The type of elements in the array.
 * @param arr1 - The first array.
 * @param arr2 - The second array.
 * @returns An array containing the elements that are present in either `arr1` or `arr2` but not in both.
 *
 * @example
 * // Returns [1, 2, 5, 6]
 * xor([1, 2, 3, 4], [3, 4, 5, 6]);
 *
 * @example
 * // Returns ['a', 'c']
 * xor(['a', 'b'], ['b', 'c']);
 */
export function xor<T>(arr1: readonly T[], arr2: readonly T[]): T[]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/array/difference.js`, `src/array/intersection.js`, `src/array/union.js`, `src/array/uniq.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/xor.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
