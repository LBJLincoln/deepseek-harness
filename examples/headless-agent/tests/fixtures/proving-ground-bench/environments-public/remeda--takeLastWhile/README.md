# Implement takeLastWhile from remeda

`src/takeLastWhile.js` is the JavaScript build of `packages/remeda/src/takeLastWhile.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `takeLastWhile`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Returns elements from the end of the array until the predicate returns false.
 * The returned elements will be in the same order as in the original array.
 *
 * @param data - The array.
 * @param predicate - A function to execute for each element in the array,
 * starting from the end. It should return `true` to keep taking elements, and
 * `false` to stop. A type-predicate can also be used to narrow the result.
 * @signature
 *    takeLastWhile(data, predicate)
 * @example
 *    takeLastWhile([1, 2, 10, 3, 4, 5], x => x < 10) // => [3, 4, 5]
 * @dataFirst
 * @category Array
 */
export function takeLastWhile(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/pipe.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/takeLastWhile.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
