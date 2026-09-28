# Implement clamp from es-toolkit

`src/math/clamp.js` is the JavaScript build of `src/math/clamp.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `clamp`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Clamps a number within the specified bounds.
 *
 * This function takes a number and one or two bounds, and returns the number clamped within the specified bounds.
 * If only one bound is provided, it returns the minimum of the value and the bound.
 *
 * @param value - The number to clamp.
 * @param bound1 - The minimum bound to clamp the number, or the maximum bound if bound2 is not provided.
 * @param [bound2] - The maximum bound to clamp the number. If not provided, the function will only consider bound1 as the upper limit.
 * @returns The clamped number within the specified bounds.
 *
 * @example
 * const result1 = clamp(10, 5); // result1 will be 5, as 10 is clamped to the bound 5
 * const result2 = clamp(10, 5, 15); // result2 will be 10, as it is within the bounds 5 and 15
 * const result3 = clamp(2, 5, 15); // result3 will be 5, as 2 is clamped to the lower bound 5
 * const result4 = clamp(20, 5, 15); // result4 will be 15, as 20 is clamped to the upper bound 15
 */
export function clamp(value: number, bound1: number, bound2?: number): number

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/math/clamp.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
