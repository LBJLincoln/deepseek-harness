# Implement tail from es-toolkit

`src/array/tail.js` is the JavaScript build of `src/array/tail.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `tail`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Returns a new array with all elements except for the first.
 *
 * This function takes an array and returns a new array containing all the elements
 * except for the first one. If the input array is empty or has only one element,
 * an empty array is returned.
 *
 * @template T - The type of elements in the array.
 * @param arr - The array to get the tail of.
 * @returns A new array containing all elements of the input array except for the first one.
 *
 * @example
 * const arr1 = [1, 2, 3];
 * const result = tail(arr1);
 * // result will be [2, 3]
 *
 * const arr2 = [1];
 * const result2 = tail(arr2);
 * // result2 will be []
 *
 * const arr3 = [];
 * const result3 = tail(arr3);
 * // result3 will be []
 */
export function tail<T>(arr: readonly T[]): T[]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/tail.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
