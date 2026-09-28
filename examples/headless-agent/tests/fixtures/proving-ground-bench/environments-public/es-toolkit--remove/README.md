# Implement remove from es-toolkit

`src/array/remove.js` is the JavaScript build of `src/array/remove.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `remove`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Removes elements from an array based on a predicate function.
 *
 * This function changes `arr` in place.
 * If you want to remove elements without modifying the original array, use `filter`.
 *
 * @template T
 * @param arr - The array to modify.
 * @param shouldRemoveElement - The function invoked per iteration to determine if an element should be removed.
 * @returns The modified array with the specified elements removed.
 *
 * @example
 * const numbers = [1, 2, 3, 4, 5];
 * remove(numbers, (value) => value % 2 === 0);
 * console.log(numbers); // [1, 3, 5]
 */
export function remove<T>(arr: T[], shouldRemoveElement: (value: T, index: number, array: T[]) => boolean): T[]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/remove.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
