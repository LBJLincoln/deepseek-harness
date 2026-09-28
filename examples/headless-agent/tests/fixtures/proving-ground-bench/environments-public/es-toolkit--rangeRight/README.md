# Implement rangeRight from es-toolkit

`src/math/rangeRight.js` is the JavaScript build of `src/math/rangeRight.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `rangeRight`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Returns an array of numbers from `end` (exclusive) to `start` (inclusive), decrementing by `step`.
 *
 * @param start - The starting number of the range (inclusive).
 * @param end - The end number of the range (exclusive).
 * @param step - The step value for the range.
 * @returns An array of numbers from `end` (exclusive) to `start` (inclusive) with the specified `step`.
 * @throws {Error} Throws an error if the step value is not a non-zero integer.
 *
 * @example
 * // Returns [3, 2, 1, 0]
 * rangeRight(4);
 *
 * @example
 * // Returns [-3, -2, -1, 0]
 * rangeRight(0, -4, -1);
 */
export function rangeRight(start: number, end?: number, step = 1): number[]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/math/rangeRight.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
