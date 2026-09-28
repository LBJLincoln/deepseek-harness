# Implement dropWhile from es-toolkit

`src/array/dropWhile.js` is the JavaScript build of `src/array/dropWhile.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `dropWhile`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Removes elements from the beginning of an array until the predicate returns false.
 *
 * This function iterates over an array and drops elements from the start until the provided
 * predicate function returns false. It then returns a new array with the remaining elements.
 *
 * @template T - The type of elements in the array.
 * @param arr - The array from which to drop elements.
 * @param canContinueDropping - A predicate function that determines
 * whether to continue dropping elements. The function is called with each element, and dropping
 * continues as long as it returns true.
 * @returns A new array with the elements remaining after the predicate returns false.
 *
 * @example
 * const array = [1, 2, 3, 4, 5];
 * const result = dropWhile(array, x => x < 3);
 * // result will be [3, 4, 5] since elements less than 3 are dropped.
 */
export function dropWhile<T>(
  arr: readonly T[],
  canContinueDropping: (item: T, index: number, arr: readonly T[]) => boolean
): T[]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/dropWhile.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
