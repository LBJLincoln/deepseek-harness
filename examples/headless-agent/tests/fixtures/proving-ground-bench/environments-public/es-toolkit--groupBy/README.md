# Implement groupBy from es-toolkit

`src/array/groupBy.js` is the JavaScript build of `src/array/groupBy.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `groupBy`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Groups the elements of an array based on a provided key-generating function.
 *
 * This function takes an array and a function that generates a key from each element. It returns
 * an object where the keys are the generated keys and the values are arrays of elements that share
 * the same key.
 *
 * @template T - The type of elements in the array.
 * @template K - The type of keys.
 * @param arr - The array to group.
 * @param getKeyFromItem - A function that generates a key from an element, its index, and the array.
 * @returns An object where each key is associated with an array of elements that
 * share that key.
 *
 * @example
 * const array = [
 *   { category: 'fruit', name: 'apple' },
 *   { category: 'fruit', name: 'banana' },
 *   { category: 'vegetable', name: 'carrot' }
 * ];
 * const result = groupBy(array, item => item.category);
 * // result will be:
 * // {
 * //   fruit: [
 * //     { category: 'fruit', name: 'apple' },
 * //     { category: 'fruit', name: 'banana' }
 * //   ],
 * //   vegetable: [
 * //     { category: 'vegetable', name: 'carrot' }
 * //   ]
 * // }
 *
 * @example
 * // Using index parameter
 * const items = ['a', 'b', 'c', 'd'];
 * const result = groupBy(items, (item, index) => index % 2 === 0 ? 'even' : 'odd');
 * // result will be: { even: ['a', 'c'], odd: ['b', 'd'] }
 */
export function groupBy<T, K extends PropertyKey>(
  arr: readonly T[],
  getKeyFromItem: (item: T, index: number, array: readonly T[]) => K
): Record<K, T[]>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/groupBy.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
