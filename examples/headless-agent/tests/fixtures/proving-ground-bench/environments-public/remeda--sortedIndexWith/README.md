# Implement sortedIndexWith from remeda

`src/sortedIndexWith.js` is the JavaScript build of `packages/remeda/src/sortedIndexWith.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `sortedIndexWith`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Performs a **binary search** for the index of the item at which the predicate
 * stops returning `true`. This function assumes that the array is "sorted" in
 * regards to the predicate, meaning that running the predicate as a mapper on
 * it would result in an array `[...true[], ...false[]]`.
 * This stricter requirement from the predicate provides us 2 benefits over
 * `findIndex` which does a similar thing:
 * 1. It would run at O(logN) time instead of O(N) time.
 * 2. It always returns a value (it would return `data.length` if the
 * predicate returns `true` for all items).
 *
 * This function is the basis for all other sortedIndex functions which search
 * for a specific item in a sorted array, and it could be used to perform
 * similar efficient searches.
 * * `sortedIndex` - scans a sorted array with a binary search, find the first suitable index.
 * * `sortedIndexBy` - like `sortedIndex`, but assumes sorting is based on a callbackfn.
 * * `sortedLastIndex` - scans a sorted array with a binary search, finding the last suitable index.
 * * `sortedLastIndexBy` - like `sortedLastIndex`, but assumes sorting is based on a callbackfn.
 *
 * See also:
 * * `findIndex` - scans a possibly unsorted array in-order (linear search).
 * * `rankBy` - scans a possibly unsorted array in-order, returning the index based on a sorting criteria.
 *
 * @param data - Array, "sorted" by `predicate`.
 * @param predicate - A predicate which also defines the array's order.
 * @returns Index (In the range 0..data.length).
 * @signature
 *    sortedIndexWith(data, predicate)
 * @example
 *    sortedIndexWith(['a','ab','abc'], (item) => item.length < 2) // => 1
 * @dataFirst
 * @category Array
 * @see findIndex, sortedIndex, sortedIndexBy, sortedLastIndex, sortedLastIndexBy
 */
export function sortedIndexWith(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/binarySearchCutoffIndex.js`, `src/internal/lazyDataLastImpl.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/sortedIndexWith.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
