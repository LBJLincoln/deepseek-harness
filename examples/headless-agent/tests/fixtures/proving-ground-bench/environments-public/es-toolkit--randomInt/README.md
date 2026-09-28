# Implement randomInt from es-toolkit

`src/math/randomInt.js` is the JavaScript build of `src/math/randomInt.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `randomInt`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Generates a random integer between minimum (inclusive) and maximum (exclusive).
 *
 * If only one argument is provided, a number between `0` and the given number is returned.
 *
 * @param minimum - The lower bound (inclusive).
 * @param maximum - The upper bound (exclusive).
 * @returns A random integer between minimum (inclusive) and maximum (exclusive).
 * @throws {Error} Throws an error if `maximum` is not greater than `minimum`.
 *
 * @example
 * const result = randomInt(0, 5); // result will be a random integer between 0 (inclusive) and 5 (exclusive)
 * const result2 = randomInt(5, 0); // This will throw an error
 */
export function randomInt(minimum: number, maximum?: number): number

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/math/random.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/math/randomInt.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
