# Implement spread from es-toolkit

`src/function/spread.js` is the JavaScript build of `src/function/spread.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `spread`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates a new function that spreads elements of an array argument into individual arguments
 * for the original function.
 *
 * @template F - A function type with any number of parameters and any return type.
 * @param func - The function to be transformed. It can be any function with any number of arguments.
 * @returns A new function that takes an array of arguments and returns the result of calling the original function with those arguments.
 *
 * @example
 * function add(a, b) {
 *   return a + b;
 * }
 *
 * const spreadAdd = spread(add);
 * console.log(spreadAdd([1, 2])); // Output: 3
 */
export function spread<F extends (...args: any[]) => any>(func: F): (argsArr: Parameters<F>) => ReturnType<F>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/function/spread.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
