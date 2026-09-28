# Implement countBy from es-toolkit

`src/array/countBy.js` is the JavaScript build of `src/array/countBy.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `countBy`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Count the occurrences of each item in an array
 * based on a transformation function.
 *
 * This function takes an array and a transformation function
 * that converts each item in the array to a key. It then
 * counts the occurrences of each transformed item and returns
 * an object with the transformed items as keys and the counts
 * as values.
 *
 * @template T - The type of the items in the input array.
 * @template K - The type of keys.
 * @param arr - The input array to count occurrences.
 * @param mapper - The transformation function that maps each item, its index, and the array to a key.
 * @returns An object containing the transformed items as keys and the
 * counts as values.
 *
 * @example
 * const array = ['a', 'b', 'c', 'a', 'b', 'a'];
 * const result = countBy(array, x => x);
 * // result will be { a: 3, b: 2, c: 1 }
 *
 * @example
 * const array = [1, 2, 3, 4, 5];
 * const result = countBy(array, item => item % 2 === 0 ? 'even' : 'odd');
 * // result will be { odd: 3, even: 2 }
 *
 * @example
 * // Using index parameter
 * const array = ['a', 'b', 'c', 'd'];
 * const result = countBy(array, (item, index) => index < 2 ? 'first' : 'rest');
 * // result will be { first: 2, rest: 2 }
 */
export function countBy<T, K extends PropertyKey>(
  arr: readonly T[],
  mapper: (item: T, index: number, array: readonly T[]) => K
): Record<K, number>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/countBy.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
