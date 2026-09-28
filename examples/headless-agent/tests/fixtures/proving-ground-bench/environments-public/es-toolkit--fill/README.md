# Implement fill from es-toolkit

`src/array/fill.js` is the JavaScript build of `src/array/fill.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `fill`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Fills elements of an array with a specified value from the start position up to, but not including, the end position.
 *
 * This function mutates the original array and replaces its elements with the provided value, starting from the specified
 * start index up to the end index (non-inclusive). If the start or end indices are not provided, it defaults to filling the
 * entire array.
 *
 * @template T - The type of elements in the original array.
 * @template U - The type of the value to fill the array with.
 * @param array - The array to fill.
 * @param value - The value to fill the array with.
 * @param [start=0] - The start position. Defaults to 0.
 * @param [end=arr.length] - The end position. Defaults to the array's length.
 * @returns The array with the filled values.
 *
 * @example
 * fill([1, 2, 3], 'a');
 * // => ['a', 'a', 'a']
 *
 * fill(Array(3), 2);
 * // => [2, 2, 2]
 *
 * fill([4, 6, 8, 10], '*', 1, 3);
 * // => [4, '*', '*', 10]
 *
 * fill([1, 2, 3], '*', -2, -1);
 * // => [1, '*', 3]
 */
export function fill<T, U>(array: Array<T | U>, value: U, start = 0, end = array.length): Array<T | U>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/fill.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
