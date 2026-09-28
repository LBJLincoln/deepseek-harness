# Implement isBuffer from es-toolkit

`src/predicate/isBuffer.js` is the JavaScript build of `src/predicate/isBuffer.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `isBuffer`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Checks if the given value is a Buffer instance.
 *
 * This function tests whether the provided value is an instance of Buffer.
 * It returns `true` if the value is a Buffer, and `false` otherwise.
 *
 * This function can also serve as a type predicate in TypeScript, narrowing the type of the argument to `Buffer`.
 *
 * @param x - The value to check if it is a Buffer.
 * @returns Returns `true` if `x` is a Buffer, else `false`.
 *
 * @example
 * const buffer = Buffer.from("test");
 * console.log(isBuffer(buffer)); // true
 *
 * const notBuffer = "not a buffer";
 * console.log(isBuffer(notBuffer)); // false
 */
export function isBuffer(x: unknown): boolean

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/_internal/globalThis.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/predicate/isBuffer.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
