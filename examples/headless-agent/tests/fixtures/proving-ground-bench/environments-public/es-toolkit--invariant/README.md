# Implement invariant from es-toolkit

`src/util/invariant.js` is the JavaScript build of `src/util/invariant.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `invariant`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Asserts that a given condition is true. If the condition is false, an error is thrown with the provided message.
 *
 * @param condition - The condition to evaluate.
 * @param [message] - The error message to throw if the condition is false.
 * @returns Returns void if the condition is true.
 * @throws {Error} Throws an error if the condition is false.
 *
 * @example
 * // This call will succeed without any errors
 * invariant(true, 'This should not throw');
 *
 * // This call will fail and throw an error with the message 'This should throw'
 * invariant(false, 'This should throw');
 *
 * // Example of using invariant with a condition
 * invariant(condition, 'Expected condition is false');
 *
 * // Ensure that the value is neither null nor undefined
 * invariant(value !== null && value !== undefined, 'Value should not be null or undefined');
 *
 * // Example of using invariant to check if a number is positive
 * invariant(number > 0, 'Number must be positive');
 */
export function invariant(condition: unknown, message: string | Error): asserts condition

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/util/invariant.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
