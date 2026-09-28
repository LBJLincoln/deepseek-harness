# Implement isEmpty from remeda

`src/isEmpty.js` is the JavaScript build of `packages/remeda/src/isEmpty.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `isEmpty`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * A function that checks if the passed parameter is empty.
 *
 * This function has *limited* utility at the type level because **negating** it
 * does not yield a useful type in most cases because of TypeScript
 * limitations. Additionally, utilities which accept a narrower input type
 * provide better type-safety on their inputs. In most cases, you should use
 * one of the following functions instead:
 * * `isEmptyish` - supports a wider range of cases, accepts any input including nullish values, and does a better job at narrowing the result.
 * * `hasAtLeast` - when the input is just an array/tuple.
 * * `isStrictEqual` - when you just need to check for a specific literal value.
 * * `isNullish` - when you just care about `null` and `undefined`.
 * * `isTruthy` - when you need to also filter `number` and `boolean`.
 *
 * @param data - The variable to check.
 * @signature
 *    isEmpty(data)
 * @example
 *    isEmpty(''); //=> true
 *    isEmpty([]); //=> true
 *    isEmpty({}); //=> true
 *
 *    isEmpty('test'); //=> false
 *    isEmpty([1, 2, 3]); //=> false
 *    isEmpty({ a: "hello" }); //=> false
 *
 *    isEmpty(undefined); // Deprecated: use `isEmptyish`
 * @category Guard
 */
export function isEmpty(data: object | string | undefined): boolean

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/isEmpty.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
