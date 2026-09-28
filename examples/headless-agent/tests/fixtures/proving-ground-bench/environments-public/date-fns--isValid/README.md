# Implement isValid from date-fns

`src/isValid/index.js` is the JavaScript build of `pkgs/core/src/isValid/index.ts` from date-fns (https://github.com/date-fns/date-fns at commit 717ce0a807ea, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `isValid`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * @name isValid
 * @category Common Helpers
 * @summary Is the given date valid?
 *
 * @description
 * Returns false if argument is Invalid Date and true otherwise.
 * Argument is converted to Date using `toDate`. See [toDate](https://date-fns.org/docs/toDate)
 * Invalid Date is a Date, whose time value is NaN.
 *
 * Time value of Date: http://es5.github.io/#x15.9.1.1
 *
 * @param date - The date to check
 *
 * @returns The date is valid
 *
 * @example
 * // For the valid date:
 * const result = isValid(new Date(2014, 1, 31))
 * //=> true
 *
 * @example
 * // For the value, convertible into a date:
 * const result = isValid(1393804800000)
 * //=> true
 *
 * @example
 * // For the invalid date:
 * const result = isValid(new Date(''))
 * //=> false
 */
export function isValid(date: unknown): boolean

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/constants/index.js`, `src/constructFrom/index.js`, `src/isDate/index.js`, `src/toDate/index.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `pkgs/core/src/isValid/index.ts` of date-fns (https://github.com/date-fns/date-fns) at commit `717ce0a807ea4c6b540d015b5c408723175b2838`, distributed under the MIT licence (Copyright (c) 2021 Sasha Koss and Lesha Koss https://kossnocorp.mit-license.org); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
