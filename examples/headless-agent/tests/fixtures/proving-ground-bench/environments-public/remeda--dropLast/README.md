# Implement dropLast from remeda

`src/dropLast.js` is the JavaScript build of `packages/remeda/src/dropLast.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `dropLast`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Removes last `n` elements from the `array`.
 *
 * Related operations:
 * - `drop` - same, but from the start of the array.
 * - `splice` - to remove or insert at an arbitrary index.
 * - `takeLast` - to keep the last `n` instead.
 *
 * @param array - The target array.
 * @param n - The number of elements to skip.
 * @signature
 *    dropLast(array, n)
 * @example
 *    dropLast([1, 2, 3, 4, 5], 2) // => [1, 2, 3]
 * @dataFirst
 * @category Array
 */
export function dropLast(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/dropLast.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
