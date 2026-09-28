# Implement sort from remeda

`src/sort.js` is the JavaScript build of `packages/remeda/src/sort.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `sort`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Sorts an array. The comparator function should accept two values at a time
 * and return a negative number if the first value is smaller, a positive number
 * if it's larger, and zero if they are equal. Sorting is based on a native
 * `sort` function.
 *
 * @param items - The array to sort.
 * @param cmp - The comparator function.
 * @signature
 *    sort(items, cmp)
 * @example
 *    sort([4, 2, 7, 5], (a, b) => a - b); // => [2, 4, 5, 7]
 * @dataFirst
 * @category Array
 */
export function sort(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/pipe.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/sort.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
