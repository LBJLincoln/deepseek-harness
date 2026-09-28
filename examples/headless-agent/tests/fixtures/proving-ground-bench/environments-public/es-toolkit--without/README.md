# Implement without from es-toolkit

`src/array/without.js` is the JavaScript build of `src/array/without.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `without`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates an array that excludes all specified values.
 *
 * It correctly excludes `NaN`, as it compares values using [SameValueZero](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-samevaluezero).
 *
 * @template T The type of elements in the array.
 * @param array - The array to filter.
 * @param values - The values to exclude.
 * @returns A new array without the specified values.
 *
 * @example
 * // Removes the specified values from the array
 * without([1, 2, 3, 4, 5], 2, 4);
 * // Returns: [1, 3, 5]
 *
 * @example
 * // Removes specified string values from the array
 * without(['a', 'b', 'c', 'a'], 'a');
 * // Returns: ['b', 'c']
 */
export function without<T>(array: readonly T[], ...values: T[]): T[]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/array/difference.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/without.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
