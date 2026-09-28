# Implement isSymbol from es-toolkit

`src/predicate/isSymbol.js` is the JavaScript build of `src/predicate/isSymbol.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `isSymbol`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Check whether a value is a symbol.
 *
 * This function can also serve as a type predicate in TypeScript, narrowing the type of the argument to `symbol`.
 *
 * @param value The value to check.
 * @returns Returns `true` if `value` is a symbol, else `false`.
 *
 * @example
 * import { isSymbol } from 'es-toolkit/predicate';
 *
 * isSymbol(Symbol('a')); // true
 * isSymbol(Symbol.for('a')); // true
 * isSymbol(Symbol.iterator); // true
 *
 * isSymbol(null); // false
 * isSymbol(undefined); // false
 * isSymbol('123'); // false
 * isSymbol(false); // false
 * isSymbol(123n); // false
 * isSymbol({}); // false
 * isSymbol([1, 2, 3]); // false
 */
export function isSymbol(value: unknown): value is symbol

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/compat/_internal/args.js`, `src/compat/_internal/falsey.js`, `src/compat/_internal/toArgs.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/predicate/isSymbol.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
