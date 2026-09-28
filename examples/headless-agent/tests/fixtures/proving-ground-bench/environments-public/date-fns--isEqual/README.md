# Implement isEqual from date-fns

`src/isEqual/index.js` is the JavaScript build of `pkgs/core/src/isEqual/index.ts` from date-fns (https://github.com/date-fns/date-fns at commit 717ce0a807ea, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `isEqual`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * @name isEqual
 * @category Common Helpers
 * @summary Are the given dates equal?
 *
 * @description
 * Are the given dates equal?
 *
 * @param dateLeft - The first date to compare
 * @param dateRight - The second date to compare
 *
 * @returns The dates are equal
 *
 * @example
 * // Are 2 July 2014 06:30:45.000 and 2 July 2014 06:30:45.500 equal?
 * const result = isEqual(
 *   new Date(2014, 6, 2, 6, 30, 45, 0),
 *   new Date(2014, 6, 2, 6, 30, 45, 500)
 * )
 * //=> false
 */
export function isEqual(
  leftDate: DateArg<Date> & {},
  rightDate: DateArg<Date> & {},
): boolean

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/constants/index.js`, `src/constructFrom/index.js`, `src/toDate/index.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `pkgs/core/src/isEqual/index.ts` of date-fns (https://github.com/date-fns/date-fns) at commit `717ce0a807ea4c6b540d015b5c408723175b2838`, distributed under the MIT licence (Copyright (c) 2021 Sasha Koss and Lesha Koss https://kossnocorp.mit-license.org); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
