# Implement once from es-toolkit

`src/function/once.js` is the JavaScript build of `src/function/once.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `once`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates a function that is restricted to invoking the provided function `func` once.
 * Repeated calls to the function will return the value from the first invocation.
 *
 * @template F - The type of function.
 * @param func - The function to restrict.
 * @returns A new function that invokes `func` once and caches the result.
 *
 * @example
 * const initialize = once(() => {
 *   console.log('Initialized!');
 *   return true;
 * });
 *
 * initialize(); // Logs: 'Initialized!' and returns true
 * initialize(); // Returns true without logging
 */
export function once<F extends (() => any) | ((...args: any[]) => void)>(func: F): F

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/function/once.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
