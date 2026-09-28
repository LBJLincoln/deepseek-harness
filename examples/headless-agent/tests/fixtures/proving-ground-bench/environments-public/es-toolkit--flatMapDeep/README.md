# Implement flatMapDeep from es-toolkit

`src/array/flatMapDeep.js` is the JavaScript build of `src/array/flatMapDeep.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `flatMapDeep`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Recursively maps each element in an array using a provided iteratee function and then deeply flattens the resulting array.
 *
 * @template T - The type of elements within the array.
 * @template U - The type of elements within the returned array from the iteratee function.
 * @param arr - The array to flatten.
 * @param iteratee - The function that produces the new array elements. It receives the element, its index, and the array.
 * @returns A new array that has been flattened.
 *
 * @example
 * const result = flatMapDeep([1, 2, 3], n => [[n, n]]);
 * // [1, 1, 2, 2, 3, 3]
 */
export function flatMapDeep<T, U>(
  arr: readonly T[],
  iteratee: (item: T, index: number, array: readonly T[]) => U
): Array<ExtractNestedArrayType<U>>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/array/flatten.js`, `src/array/flattenDeep.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/flatMapDeep.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
