# Implement last from es-toolkit

`src/array/last.js` is the JavaScript build of `src/array/last.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `last`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Returns the last element of an array.
 *
 * This function takes an array and returns the last element of the array.
 * If the array is empty, the function returns `undefined`.
 *
 * Unlike some implementations, this function is optimized for performance
 * by directly accessing the last index of the array.
 *
 * @template T - The type of elements in the array.
 * @param arr - The array from which to get the last element.
 * @returns The last element of the array, or `undefined` if the array is empty.
 *
 * @example
 * const arr = [1, 2, 3];
 * const lastElement = last(arr);
 * // lastElement will be 3
 *
 * const emptyArr: number[] = [];
 * const noElement = last(emptyArr);
 * // noElement will be undefined
 */
export function last<T>(arr: readonly T[]): T | undefined

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/last.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
