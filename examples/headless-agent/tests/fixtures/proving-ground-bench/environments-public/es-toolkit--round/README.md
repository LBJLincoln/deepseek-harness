# Implement round from es-toolkit

`src/math/round.js` is the JavaScript build of `src/math/round.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `round`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Rounds a number to a specified precision.
 *
 * This function takes a number and an optional precision value, and returns the number rounded
 * to the specified number of decimal places.
 *
 * @param value - The number to round.
 * @param [precision=0] - The number of decimal places to round to. Defaults to 0.
 * @returns The rounded number.
 * @throws {Error} Throws an error if `Precision` is not integer.
 *
 * @example
 * const result1 = round(1.2345); // result1 will be 1
 * const result2 = round(1.2345, 2); // result2 will be 1.23
 * const result3 = round(1.2345, 3); // result3 will be 1.235
 * const result4 = round(1.2345, 3.1); // This will throw an error
 */
export function round(value: number, precision = 0): number

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/math/round.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
