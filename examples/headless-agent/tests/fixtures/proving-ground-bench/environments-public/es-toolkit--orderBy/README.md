# Implement orderBy from es-toolkit

`src/array/orderBy.js` is the JavaScript build of `src/array/orderBy.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `orderBy`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Sorts an array of objects based on the given `criteria` and their corresponding order directions.
 *
 * - If you provide keys, it sorts the objects by the values of those keys.
 * - If you provide functions, it sorts based on the values returned by those functions.
 *
 * The function returns the array of objects sorted in corresponding order directions.
 * If two objects have the same value for the current criterion, it uses the next criterion to determine their order.
 * If the number of orders is less than the number of criteria, it uses the last order for the rest of the criteria.
 *
 * @template T - The type of elements in the array.
 * @param arr - The array of objects to be sorted.
 * @param criteria  - The criteria for sorting. This can be an array of object keys or functions that return values used for sorting.
 * @param orders - An array of order directions ('asc' for ascending or 'desc' for descending).
 * @returns The sorted array.
 *
 * @example
 * // Sort an array of objects by 'user' in ascending order and 'age' in descending order.
 * const users = [
 *   { user: 'fred', age: 48 },
 *   { user: 'barney', age: 34 },
 *   { user: 'fred', age: 40 },
 *   { user: 'barney', age: 36 },
 * ];
 *
 * const result = orderBy(users, [obj => obj.user, 'age'], ['asc', 'desc']);
 * // result will be:
 * // [
 * //   { user: 'barney', age: 36 },
 * //   { user: 'barney', age: 34 },
 * //   { user: 'fred', age: 48 },
 * //   { user: 'fred', age: 40 },
 * // ]
 */
export function orderBy<T extends object>(
  arr: readonly T[],
  criteria: ReadonlyArray<((item: T) => unknown) | keyof T>,
  orders: ReadonlyArray<'asc' | 'desc'>
): T[]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/_internal/compareValues.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/orderBy.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
