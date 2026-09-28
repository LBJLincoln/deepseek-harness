# Implement isTruthy from remeda

`src/isTruthy.js` is the JavaScript build of `packages/remeda/src/isTruthy.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `isTruthy`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * A function that checks if the passed parameter is truthy and narrows its type accordingly.
 *
 * @param data - The variable to check.
 * @returns True if the passed input is truthy, false otherwise.
 * @signature
 *    isTruthy(data)
 * @example
 *    isTruthy('somethingElse') //=> true
 *    isTruthy(null) //=> false
 *    isTruthy(undefined) //=> false
 *    isTruthy(false) //=> false
 *    isTruthy(0) //=> false
 *    isTruthy('') //=> false
 * @category Guard
 */
export function isTruthy<T>(
  data: T,
): data is Exclude<T, "" | 0 | false | null | undefined>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/isTruthy.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
