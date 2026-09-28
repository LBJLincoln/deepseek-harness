# Implement inRange from es-toolkit

`src/math/inRange.js` is the JavaScript build of `src/math/inRange.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `inRange`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Checks if the value is within a specified range.
 *
 * @param value The value to check.
 * @param minimum The lower bound of the range (inclusive).
 * @param maximum The upper bound of the range (exclusive).
 * @returns `true` if the value is within the specified range, otherwise `false`.
 * @throws {Error} Throws an error if the `minimum` is greater or equal than the `maximum`.
 *
 * @example
 * const result1 = inRange(3, 5); // result1 will be true.
 * const result2 = inRange(1, 2, 5); // result2 will be false.
 * const result3 = inRange(1, 5, 2); // If the minimum is greater or equal than the maximum, an error is thrown.
 */
export function inRange(value: number, minimum: number, maximum?: number): boolean

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/math/inRange.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
