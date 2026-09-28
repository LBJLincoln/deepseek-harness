# Implement initial from es-toolkit

`src/array/initial.js` is the JavaScript build of `src/array/initial.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `initial`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Returns a new array containing all elements except the last one from the input array.
 * If the input array is empty or has only one element, the function returns an empty array.
 *
 * @template T The type of elements in the array.
 * @param arr - The input array.
 * @returns A new array containing all but the last element of the input array.
 *
 * @example
 * const arr = [1, 2, 3, 4];
 * const result = initial(arr);
 * // result will be [1, 2, 3]
 */
export function initial<T>(arr: readonly T[]): T[]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/initial.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
