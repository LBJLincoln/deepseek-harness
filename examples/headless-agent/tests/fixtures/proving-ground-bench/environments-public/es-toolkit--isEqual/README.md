# Implement isEqual from es-toolkit

`src/predicate/isEqual.js` is the JavaScript build of `src/predicate/isEqual.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `isEqual`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Checks if two values are equal, including support for `Date`, `RegExp`, and deep object comparison.
 *
 * @param a - The first value to compare.
 * @param b - The second value to compare.
 * @returns `true` if the values are equal, otherwise `false`.
 *
 * @example
 * isEqual(1, 1); // true
 * isEqual({ a: 1 }, { a: 1 }); // true
 * isEqual(/abc/g, /abc/g); // true
 * isEqual(new Date('2020-01-01'), new Date('2020-01-01')); // true
 * isEqual([1, 2, 3], [1, 2, 3]); // true
 */
export function isEqual(a: any, b: any): boolean

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/_internal/globalThis.js`, `src/compat/_internal/getSymbols.js`, `src/compat/_internal/getTag.js`, `src/compat/_internal/tags.js`, `src/compat/util/eq.js`, `src/function/noop.js`, `src/predicate/isBuffer.js`, `src/predicate/isEqualWith.js`, `src/predicate/isPlainObject.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/predicate/isEqual.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
