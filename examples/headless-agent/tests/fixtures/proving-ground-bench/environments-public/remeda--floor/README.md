# Implement floor from remeda

`src/floor.js` is the JavaScript build of `packages/remeda/src/floor.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `floor`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Rounds down a given number to a specific precision.
 * If you'd like to round down to an integer (i.e. use this function with constant `precision === 0`),
 * use `Math.floor` instead, as it won't incur the additional library overhead.
 *
 * @param value - The number to round down.
 * @param precision - The precision to round down to. Must be an integer between -15 and 15.
 * @signature
 *    floor(value, precision);
 * @example
 *    floor(123.9876, 3) // => 123.987
 *    floor(483.22243, 1) // => 483.2
 *    floor(8541, -1) // => 8540
 *    floor(456789, -3) // => 456000
 * @dataFirst
 * @category Number
 */
export function floor(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/internal/withPrecision.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/floor.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
