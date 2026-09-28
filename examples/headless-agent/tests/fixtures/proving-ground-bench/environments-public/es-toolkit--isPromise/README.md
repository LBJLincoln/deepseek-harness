# Implement isPromise from es-toolkit

`src/predicate/isPromise.js` is the JavaScript build of `src/predicate/isPromise.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `isPromise`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Checks if a given value is `Promise`.
 *
 * This function can also serve as a type predicate in TypeScript, narrowing the type of the argument to `Promise`.
 *
 * @param value The value to check if it is a `Promise`.
 * @returns Returns `true` if `value` is a `Promise`, else `false`.
 *
 * @example
 * const value1 = new Promise((resolve) => resolve());
 * const value2 = {};
 * const value3 = 123;
 *
 * console.log(isPromise(value1)); // true
 * console.log(isPromise(value2)); // false
 * console.log(isPromise(value3)); // false
 */
export function isPromise(value: unknown): value is Promise<any>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/predicate/isPromise.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
