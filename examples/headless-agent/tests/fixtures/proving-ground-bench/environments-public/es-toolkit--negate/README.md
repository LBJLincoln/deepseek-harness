# Implement negate from es-toolkit

`src/function/negate.js` is the JavaScript build of `src/function/negate.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `negate`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates a function that negates the result of the predicate function.
 *
 * @template F - The type of the function to negate.
 * @param func - The function to negate.
 * @returns The new negated function, which negates the boolean result of `func`.
 *
 * @example
 * const array = [1, 2, 3, 4, 5, 6];
 * const isEven = (n: number) => n % 2 === 0;
 * const result = array.filter(negate(isEven));
 * // result will be [1, 3, 5]
 */
export function negate<F extends (...args: any[]) => boolean>(func: F): F

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/function/negate.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
