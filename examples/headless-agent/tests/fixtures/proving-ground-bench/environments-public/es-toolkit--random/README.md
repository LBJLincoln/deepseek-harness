# Implement random from es-toolkit

`src/math/random.js` is the JavaScript build of `src/math/random.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `random`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Generate a random number within the given range.
 *
 * @param minimum - The lower bound (inclusive).
 * @param maximum - The upper bound (exclusive).
 * @returns A random number between minimum (inclusive) and maximum (exclusive). The number can be an integer or a decimal.
 * @throws {Error} Throws an error if `maximum` is not greater than `minimum`.
 *
 * @example
 * const result1 = random(0, 5); // Returns a random number between 0 and 5.
 * const result2 = random(5, 0); // If the minimum is greater than the maximum, an error is thrown.
 * const result3 = random(5, 5); // If the minimum is equal to the maximum, an error is thrown.
 */
export function random(minimum: number, maximum?: number): number

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/math/random.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
