# Implement differenceInSeconds from date-fns

`src/differenceInSeconds/index.js` is the JavaScript build of `pkgs/core/src/differenceInSeconds/index.ts` from date-fns (https://github.com/date-fns/date-fns at commit 717ce0a807ea, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `differenceInSeconds`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * @name differenceInSeconds
 * @category Second Helpers
 * @summary Get the number of seconds between the given dates.
 *
 * @description
 * Get the number of seconds between the given dates.
 *
 * **You don't need date-fns\***:
 *
 * Temporal has a built-in [`Temporal.Instant.prototype.until()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/Instant/until) method that can return the elapsed seconds between two instants.
 *
 * \* **Not really**, see: https://date-fns.org/you-dont-need-date-fns
 *
 * @param laterDate - The later date
 * @param earlierDate - The earlier date
 * @param options - An object with options.
 *
 * @returns The number of seconds
 *
 * @example
 * // How many seconds are between
 * // 2 July 2014 12:30:07.999 and 2 July 2014 12:30:20.000?
 * const result = differenceInSeconds(
 *   new Date(2014, 6, 2, 12, 30, 20, 0),
 *   new Date(2014, 6, 2, 12, 30, 7, 999)
 * )
 * //=> 12
 *
 * @example
 * // Using Temporal:
 * const earlier = Temporal.Instant.from("2014-07-02T12:30:07.999Z")
 * const later = Temporal.Instant.from("2014-07-02T12:30:20.000Z")
 * const result = earlier.until(later, {
 *   largestUnit: "seconds",
 *   smallestUnit: "seconds",
 *   roundingMode: "trunc",
 * }).seconds
 * //=> 12
 */
export function differenceInSeconds(
  laterDate: DateArg<Date> & {},
  earlierDate: DateArg<Date> & {},
  options?: DifferenceInSecondsOptions,
): number

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/_lib/getRoundingMethod/index.js`, `src/constants/index.js`, `src/constructFrom/index.js`, `src/differenceInMilliseconds/index.js`, `src/toDate/index.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `pkgs/core/src/differenceInSeconds/index.ts` of date-fns (https://github.com/date-fns/date-fns) at commit `717ce0a807ea4c6b540d015b5c408723175b2838`, distributed under the MIT licence (Copyright (c) 2021 Sasha Koss and Lesha Koss https://kossnocorp.mit-license.org); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/differenceInSeconds/index.js` erased them.

```ts
/**
 * The {@link differenceInSeconds} function options.
 */
export interface DifferenceInSecondsOptions extends RoundingOptions {}
```
