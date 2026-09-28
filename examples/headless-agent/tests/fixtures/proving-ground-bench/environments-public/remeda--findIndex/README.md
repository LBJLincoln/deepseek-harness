# Implement findIndex from remeda

`src/findIndex.js` is the JavaScript build of `packages/remeda/src/findIndex.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `findIndex`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Returns the index of the first element in an array that satisfies the
 * provided testing function. If no elements satisfy the testing function, -1 is
 * returned.
 *
 * See also the `find` method, which returns the first element that satisfies
 * the testing function (rather than its index).
 *
 * @param data - The items to search in.
 * @param predicate - A function to execute for each element in the array. It
 * should return a `true` to indicate a matching element has been found, and a
 * `false` otherwise.
 * @returns The index of the first element in the array that passes the test.
 * Otherwise, -1.
 * @signature
 *    findIndex(data, predicate)
 * @example
 *    findIndex([1, 3, 4, 6], n => n % 2 === 0) // => 2
 * @dataFirst
 * @category Array
 */
export function findIndex(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/pipe.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/findIndex.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
