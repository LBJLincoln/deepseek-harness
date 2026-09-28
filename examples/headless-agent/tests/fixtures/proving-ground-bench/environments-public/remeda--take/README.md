# Implement take from remeda

`src/take.js` is the JavaScript build of `packages/remeda/src/take.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `take`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Returns the first `n` elements of `array`.
 *
 * Related operations:
 * - `drop` - to skip past the first `n` instead.
 * - `splice` - to remove or insert at an arbitrary index.
 * - `takeLast` - same, but from the end of the array.
 *
 * @param array - The array.
 * @param n - The number of elements to take.
 * @signature
 *    take(array, n)
 * @example
 *    take([1, 2, 3, 4, 3, 2, 1], 3) // => [1, 2, 3]
 * @dataFirst
 * @lazy
 * @category Array
 */
export function take(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/add.js`, `src/constant.js`, `src/difference.js`, `src/drop.js`, `src/filter.js`, `src/flat.js`, `src/identity.js`, `src/internal/lazyDataLastImpl.js`, `src/internal/purryFromLazy.js`, `src/internal/utilityEvaluators.js`, `src/isIncludedIn.js`, `src/isNot.js`, `src/map.js`, `src/mapWithFeedback.js`, `src/multiply.js`, `src/pipe.js`, `src/prop.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/take.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
