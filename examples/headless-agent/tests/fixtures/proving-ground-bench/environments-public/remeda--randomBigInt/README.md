# Implement randomBigInt from remeda

`src/randomBigInt.js` is the JavaScript build of `packages/remeda/src/randomBigInt.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `randomBigInt`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Generate a random `bigint` between `from` and `to` (inclusive).
 *
 * ! Important: In most environments this function uses
 * [`crypto.getRandomValues()`](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues)
 * under-the-hood which **is** cryptographically strong. When the WebCrypto API
 * isn't available (Node 18) we fallback to an implementation that uses
 * [`Math.random()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/random)
 * which is **NOT** cryptographically secure.
 *
 * @param from - The minimum value.
 * @param to - The maximum value.
 * @returns The random integer.
 * @signature
 *   randomBigInt(from, to)
 * @example
 *   randomBigInt(1n, 10n) // => 5n
 * @dataFirst
 * @category Number
 */
export function randomBigInt(from: bigint, to: bigint): bigint

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/randomBigInt.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
