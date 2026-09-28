# Implement isStrictEqual from remeda

`src/isStrictEqual.js` is the JavaScript build of `packages/remeda/src/isStrictEqual.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `isStrictEqual`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Determines whether two values are *functionally identical* in all contexts.
 * For primitive values (string, number), this is done by-value, and for objects
 * it is done by-reference (i.e., they point to the same object in memory).
 *
 * Under the hood we use **both** the [`===` operator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Strict_equality)
 * and [`Object.is`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/is). This means that `isStrictEqual(NaN, NaN) === true`
 * (whereas `NaN !== NaN`), and `isStrictEqual(-0, 0) === true` (whereas
 * `Object.is(-0, 0) === false`).
 *
 * The result would be narrowed to the second value so that the function can be
 * used as a type guard.
 *
 * See:
 * - `isDeepEqual` for a semantic comparison that allows comparing arrays and
 * objects "by-value", and recurses for every item.
 * - `isShallowEqual` if you need to compare arrays and objects "by-value" but
 * don't want to recurse into their values.
 *
 * @param data - The first value to compare.
 * @param other - The second value to compare.
 * @signature
 *    isStrictEqual(data, other)
 * @example
 *    isStrictEqual(1, 1) //=> true
 *    isStrictEqual(1, '1') //=> false
 *    isStrictEqual([1, 2, 3], [1, 2, 3]) //=> false
 * @dataFirst
 * @category Guard
 */
export function isStrictEqual(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/constant.js`, `src/countBy.js`, `src/identity.js`, `src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/isDefined.js`, `src/isNot.js`, `src/isNullish.js`, `src/isString.js`, `src/map.js`, `src/pipe.js`, `src/prop.js`, `src/purry.js`, `src/toLowerCase.js`, `src/when.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/isStrictEqual.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
