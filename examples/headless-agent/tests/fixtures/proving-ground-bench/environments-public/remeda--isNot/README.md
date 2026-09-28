# Implement isNot from remeda

`src/isNot.js` is the JavaScript build of `packages/remeda/src/isNot.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `isNot`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * A function that takes a guard function as predicate and returns a guard that negates it.
 *
 * @param predicate - The guard function to negate.
 * @signature
 *    isNot(isTruthy)(data)
 * @example
 *    isNot(isTruthy)(false) //=> true
 *    isNot(isTruthy)(true) //=> false
 * @dataLast
 * @category Guard
 */
export function isNot<T>(
  predicate: (data: T) => boolean,
): (data: T) => boolean

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/constant.js`, `src/filter.js`, `src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/isDefined.js`, `src/isIncludedIn.js`, `src/isNullish.js`, `src/isStrictEqual.js`, `src/isString.js`, `src/map.js`, `src/pipe.js`, `src/purry.js`, `src/take.js`, `src/when.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/isNot.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
