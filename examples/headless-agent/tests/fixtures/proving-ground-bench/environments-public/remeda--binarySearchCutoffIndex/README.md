# Implement binarySearchCutoffIndex from remeda

`src/internal/binarySearchCutoffIndex.js` is the JavaScript build of `packages/remeda/src/internal/binarySearchCutoffIndex.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `binarySearchCutoffIndex`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * A binary search implementation that finds the index at which `predicate`
 * stops returning `true` and starts returning `false` (consistently) when run
 * on the items of the array. It **assumes** that mapping the array via the
 * predicate results in the shape `[...true[], ...false[]]`. *For any other case
 * the result is unpredictable*.
 *
 * This is the base implementation of the `sortedIndex` functions which define
 * the predicate for the user, for common use-cases.
 *
 * It is similar to `findIndex`, but runs at O(logN), whereas the latter is
 * general purpose function which runs on any array and predicate, but runs at
 * O(N) time.
 */
export function binarySearchCutoffIndex<T>(
  array: readonly T[],
  predicate: (value: T, index: number, data: readonly T[]) => boolean,
): number

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/internal/binarySearchCutoffIndex.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
