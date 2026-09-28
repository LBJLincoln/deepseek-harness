# Implement differenceInMilliseconds from date-fns

`src/differenceInMilliseconds/index.js` is the JavaScript build of `pkgs/core/src/differenceInMilliseconds/index.ts` from date-fns (https://github.com/date-fns/date-fns at commit 717ce0a807ea, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `differenceInMilliseconds`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * @name differenceInMilliseconds
 * @category Millisecond Helpers
 * @summary Get the number of milliseconds between the given dates.
 *
 * @description
 * Get the number of milliseconds between the given dates.
 *
 * **You don't need date-fns\***:
 *
 * Temporal instants expose their Unix timestamp through [`Temporal.Instant.prototype.epochMilliseconds`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/Instant/epochMilliseconds), so subtract the earlier value from the later value.
 *
 * \* **Not really**, see: https://date-fns.org/you-dont-need-date-fns
 *
 * @param laterDate - The later date
 * @param earlierDate - The earlier date
 *
 * @returns The number of milliseconds
 *
 * @example
 * // How many milliseconds are between
 * // 2 July 2014 12:30:20.600 and 2 July 2014 12:30:21.700?
 * const result = differenceInMilliseconds(
 *   new Date(2014, 6, 2, 12, 30, 21, 700),
 *   new Date(2014, 6, 2, 12, 30, 20, 600)
 * )
 * //=> 1100
 *
 * @example
 * // Using Temporal:
 * const earlier = Temporal.Instant.from("2014-07-02T12:30:20.600Z")
 * const later = Temporal.Instant.from("2014-07-02T12:30:21.700Z")
 * const result = later.epochMilliseconds - earlier.epochMilliseconds
 * //=> 1100
 */
export function differenceInMilliseconds(
  laterDate: DateArg<Date> & {},
  earlierDate: DateArg<Date> & {},
): number

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/constants/index.js`, `src/constructFrom/index.js`, `src/toDate/index.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `pkgs/core/src/differenceInMilliseconds/index.ts` of date-fns (https://github.com/date-fns/date-fns) at commit `717ce0a807ea4c6b540d015b5c408723175b2838`, distributed under the MIT licence (Copyright (c) 2021 Sasha Koss and Lesha Koss https://kossnocorp.mit-license.org); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
