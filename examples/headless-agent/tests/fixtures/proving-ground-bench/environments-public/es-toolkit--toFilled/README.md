# Implement toFilled from es-toolkit

`src/array/toFilled.js` is the JavaScript build of `src/array/toFilled.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `toFilled`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates a new array filled with the specified value from the start position up to, but not including, the end position.
 * This function does not mutate the original array.
 *
 * @template T - The type of elements in the original array.
 * @template U - The type of the value to fill the new array with.
 * @param arr - The array to base the new array on.
 * @param value - The value to fill the new array with.
 * @param [start=0] - The start position. Defaults to 0.
 * @param [end=arr.length] - The end position. Defaults to the array's length.
 * @returns The new array with the filled values.
 */
export function toFilled<T, U>(arr: readonly T[], value: U, start = 0, end = arr.length): Array<T | U>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/toFilled.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
