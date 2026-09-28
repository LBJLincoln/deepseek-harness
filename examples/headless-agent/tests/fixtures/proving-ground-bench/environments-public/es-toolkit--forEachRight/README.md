# Implement forEachRight from es-toolkit

`src/array/forEachRight.js` is the JavaScript build of `src/array/forEachRight.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `forEachRight`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Iterates over elements of 'arr' from right to left and invokes 'callback' for each element.
 *
 * @template T - The type of elements in the array.
 * @param arr - The array to iterate over.
 * @param callback - The function invoked per iteration.
 * The callback function receives three arguments:
 *  - 'value': The current element being processed in the array.
 *  - 'index': The index of the current element being processed in the array.
 *  - 'arr': The array 'forEachRight' was called upon.
 *
 * @example
 * const array = [1, 2, 3];
 * const result: number[] = [];
 *
 * // Use the forEachRight function to iterate through the array and add each element to the result array.
 * forEachRight(array, (value) => {
 *  result.push(value);
 * })
 *
 * console.log(result) // Output: [3, 2, 1]
 */
export function forEachRight<T>(arr: readonly T[], callback: (value: T, index: number, arr: T[]) => void): void

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/forEachRight.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
