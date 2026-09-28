# Implement sortKeys from es-toolkit

`src/object/sortKeys.js` is the JavaScript build of `src/object/sortKeys.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `sortKeys`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates a new object with the keys sorted.
 *
 * The keys are sorted alphabetically by default, but a custom compare function can be provided.
 *
 * @template T - The type of the object.
 * @param object - The object to sort keys from.
 * @param [compareKeys] - A custom compare function for sorting keys.
 * @returns A new object with the keys sorted.
 *
 * @example
 * sortKeys({ b: 2, a: 1, c: 3 });
 * // => { a: 1, b: 2, c: 3 }
 *
 * @example
 * sortKeys({ b: 2, a: 1, c: 3 }, (a, b) => b.localeCompare(a));
 * // => { c: 3, b: 2, a: 1 }
 */
export function sortKeys<T extends Record<string, any>>(object: T, compareKeys?: (a: string, b: string) => number): T

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/object/sortKeys.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
