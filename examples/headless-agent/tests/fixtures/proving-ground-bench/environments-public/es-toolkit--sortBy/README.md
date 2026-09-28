# Implement sortBy from es-toolkit

`src/array/sortBy.js` is the JavaScript build of `src/array/sortBy.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `sortBy`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Sorts an array of objects based on the given `criteria`.
 *
 * - If you provide keys, it sorts the objects by the values of those keys.
 * - If you provide functions, it sorts based on the values returned by those functions.
 *
 * The function returns the array of objects sorted in ascending order.
 * If two objects have the same value for the current criterion, it uses the next criterion to determine their order.
 *
 * @template T - The type of the objects in the array.
 * @param arr - The array of objects to be sorted.
 * @param criteria - The criteria for sorting. This can be an array of object keys or functions that return values used for sorting.
 * @returns The sorted array.
 *
 * @example
 * const users = [
 *  { user: 'foo', age: 24 },
 *  { user: 'bar', age: 7 },
 *  { user: 'foo', age: 8 },
 *  { user: 'bar', age: 29 },
 * ];
 *
 * sortBy(users, ['user', 'age']);
 * sortBy(users, [obj => obj.user, 'age']);
 * // results will be:
 * // [
 * //   { user : 'bar', age: 7 },
 * //   { user : 'bar', age: 29 },
 * //   { user : 'foo', age: 8 },
 * //   { user : 'foo', age: 24 },
 * // ]
 */
export function sortBy<T extends object>(
  arr: readonly T[],
  criteria: ReadonlyArray<((item: T) => unknown) | keyof T>
): T[]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/_internal/compareValues.js`, `src/array/orderBy.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/sortBy.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
