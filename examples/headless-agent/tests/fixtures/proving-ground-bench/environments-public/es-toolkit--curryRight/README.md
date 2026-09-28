# Implement curryRight from es-toolkit

`src/function/curryRight.js` is the JavaScript build of `src/function/curryRight.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `curryRight`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Curries a function, allowing it to be called with a single argument at a time and returning a new function that takes the next argument.
 * This process continues until all arguments have been provided, at which point the original function is called with all accumulated arguments.
 *
 * Unlike `curry`, this function curries the function from right to left.
 *
 * @param func - The function to curry.
 * @returns A curried function.
 *
 * @example
 * function sum(a: number, b: number, c: number) {
 *   return a + b + c;
 * }
 *
 * const curriedSum = curryRight(sum);
 *
 * // The parameter `c` should be given the value `10`.
 * const add10 = curriedSum(10);
 *
 * // The parameter `b` should be given the value `15`.
 * const add25 = add10(15);
 *
 * // The parameter `a` should be given the value `5`. The function 'sum' has received all its arguments and will now return a value.
 * const result = add25(5); // 30
 */
export function curryRight(func: (...args: any[]) => any): (...args: any[]) => any

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/function/curryRight.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
