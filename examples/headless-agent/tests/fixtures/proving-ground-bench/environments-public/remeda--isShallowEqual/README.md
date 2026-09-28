# Implement isShallowEqual from remeda

`src/isShallowEqual.js` is the JavaScript build of `packages/remeda/src/isShallowEqual.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `isShallowEqual`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Performs a *shallow structural* comparison between two values to determine if
 * they are equivalent. For primitive values this is equivalent to `===`, for
 * arrays a **strict equality** check would be performed on every item, in
 * order, and for objects props will be matched and checked for **strict
 * equality**; Unlike `isDeepEqual` where the function also *recurses* into each
 * item and value.
 *
 * !IMPORTANT: symbol properties of objects are not supported right now and
 * might result in unexpected behavior. Please open an issue in the Remeda
 * github project if you need support for these types.
 *
 * !IMPORTANT: Promise, Date, and RegExp, are shallowly equal, even when they
 * are semantically different (e.g. resolved promises); but `isDeepEqual` does
 * compare the latter 2 semantically by-value.
 *
 * The result would be narrowed to the second value so that the function can be
 * used as a type guard.
 *
 * See:
 * - `isStrictEqual` if you don't need a deep comparison and just want to check
 * for simple (`===`, `Object.is`) equality.
 * - `isDeepEqual` for a recursively deep check of arrays and objects.
 *
 * @param data - The first value to compare.
 * @param other - The second value to compare.
 * @signature
 *    isShallowEqual(data, other)
 * @example
 *    isShallowEqual(1, 1) //=> true
 *    isShallowEqual(1, '1') //=> false
 *    isShallowEqual([1, 2, 3], [1, 2, 3]) //=> true
 *    isShallowEqual([[1], [2], [3]], [[1], [2], [3]]) //=> false
 * @dataFirst
 * @category Guard
 */
export function isShallowEqual(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/isShallowEqual.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
