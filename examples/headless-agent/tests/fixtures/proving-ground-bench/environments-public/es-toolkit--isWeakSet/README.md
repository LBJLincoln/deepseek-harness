# Implement isWeakSet from es-toolkit

`src/predicate/isWeakSet.js` is the JavaScript build of `src/predicate/isWeakSet.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `isWeakSet`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Checks if the given value is a `WeakSet`.
 *
 * This function tests whether the provided value is an instance of `WeakSet`.
 * It returns `true` if the value is a `WeakSet`, and `false` otherwise.
 *
 * This function can also serve as a type predicate in TypeScript, narrowing the type of the argument to `WeakSet`.
 *
 * @param value - The value to test if it is a `WeakSet`.
 * @returns true if the value is a `WeakSet`, false otherwise.
 *
 * @example
 * const value1 = new WeakSet();
 * const value2 = new Map();
 * const value3 = new Set();
 *
 * console.log(isWeakSet(value1)); // true
 * console.log(isWeakSet(value2)); // false
 * console.log(isWeakSet(value3)); // false
 */
export function isWeakSet(value: unknown): value is WeakSet<WeakKey>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/predicate/isWeakSet.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
