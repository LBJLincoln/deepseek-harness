# Implement sortedLastIndexBy from remeda

`src/sortedLastIndexBy.js` is the JavaScript build of `packages/remeda/src/sortedLastIndexBy.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `sortedLastIndexBy`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Find the insertion position (index) of an item in an array with items sorted
 * in ascending order using a value function; so that
 * `splice(sortedIndex, 0, item)` would result in maintaining the arrays sort-
 * ness. The array can contain duplicates.
 * If the item already exists in the array the index would be of the *last*
 * occurrence of the item.
 *
 * Runs in O(logN) time.
 *
 * See also:
 * * `findIndex` - scans a possibly unsorted array in-order (linear search).
 * * `sortedLastIndex` - a simplified version of this function, without a callbackfn.
 * * `sortedIndexBy` - like this function, but returns the first suitable index.
 * * `sortedIndex` - like `sortedLastIndex` but without a callbackfn.
 * * `rankBy` - scans a possibly unsorted array in-order, returning the index based on a sorting criteria.
 *
 * @param data - The (ascending) sorted array.
 * @param item - The item to insert.
 * @param valueFunction - All comparisons would be performed on the result of
 * calling this function on each compared item. Preferably this function should
 * return a `number` or `string`. This function should be the same as the one
 * provided to sortBy to sort the array. The function is called exactly once on
 * each items that is compared against in the array, and once at the beginning
 * on `item`. When called on `item` the `index` argument is `undefined`.
 * @returns Insertion index (In the range 0..data.length).
 * @signature
 *    sortedLastIndexBy(data, item, valueFunction)
 * @example
 *    sortedLastIndexBy([{age:20},{age:22}],{age:21},prop('age')) // => 1
 * @dataFirst
 * @category Array
 */
export function sortedLastIndexBy(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/binarySearchCutoffIndex.js`, `src/internal/lazyDataLastImpl.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/sortedLastIndexBy.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
