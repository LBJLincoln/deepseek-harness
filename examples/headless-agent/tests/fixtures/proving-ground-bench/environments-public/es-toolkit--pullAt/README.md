# Implement pullAt from es-toolkit

`src/array/pullAt.js` is the JavaScript build of `src/array/pullAt.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `pullAt`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Removes elements from an array at specified indices and returns the removed elements.
 *
 * This function supports negative indices, which count from the end of the array.
 *
 * @template T
 * @param arr - The array from which elements will be removed.
 * @param indicesToRemove - An array of indices specifying the positions of elements to remove.
 * @returns An array containing the elements that were removed from the original array.
 *
 * @example
 * const numbers = [10, 20, 30, 40, 50];
 * const removed = pullAt(numbers, [1, 3, 4]);
 * console.log(removed); // [20, 40, 50]
 * console.log(numbers); // [10, 30]
 */
export function pullAt<T>(arr: T[], indicesToRemove: readonly number[]): T[]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/array/at.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/pullAt.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
