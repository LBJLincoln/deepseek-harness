# Implement isBoolean from es-toolkit

`src/predicate/isBoolean.js` is the JavaScript build of `src/predicate/isBoolean.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `isBoolean`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Checks if the given value is boolean.
 *
 * This function tests whether the provided value is strictly `boolean`.
 * It returns `true` if the value is `boolean`, and `false` otherwise.
 *
 * This function can also serve as a type predicate in TypeScript, narrowing the type of the argument to `boolean`.
 *
 * @param x - The Value to test if it is boolean.
 * @returns True if the value is boolean, false otherwise.
 *
 * @example
 *
 * const value1 = true;
 * const value2 = 0;
 * const value3 = 'abc';
 *
 * console.log(isBoolean(value1)); // true
 * console.log(isBoolean(value2)); // false
 * console.log(isBoolean(value3)); // false
 *
 */
export function isBoolean(x: unknown): x is boolean

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/predicate/isBoolean.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
