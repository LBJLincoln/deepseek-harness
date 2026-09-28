# Implement intervalToDuration from date-fns

`src/intervalToDuration/index.js` is the JavaScript build of `pkgs/core/src/intervalToDuration/index.ts` from date-fns (https://github.com/date-fns/date-fns at commit 717ce0a807ea, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `intervalToDuration`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * @name intervalToDuration
 * @category Common Helpers
 * @summary Convert interval to duration
 *
 * @description
 * Convert an interval object to a duration object.
 *
 * @param interval - The interval to convert to duration
 * @param options - The context options
 *
 * @returns The duration object
 *
 * @example
 * // Get the duration between January 15, 1929 and April 4, 1968.
 * intervalToDuration({
 *   start: new Date(1929, 0, 15, 12, 0, 0),
 *   end: new Date(1968, 3, 4, 19, 5, 0)
 * });
 * //=> { years: 39, months: 2, days: 20, hours: 7, minutes: 5, seconds: 0 }
 */
export function intervalToDuration(
  interval: Interval,
  options?: IntervalToDurationOptions | undefined,
): Duration

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/_lib/getRoundingMethod/index.js`, `src/_lib/getTimezoneOffsetInMilliseconds/index.js`, `src/_lib/normalizeDates/index.js`, `src/_lib/normalizeInterval/index.js`, `src/add/index.js`, `src/addDays/index.js`, `src/addMonths/index.js`, `src/compareAsc/index.js`, `src/constants/index.js`, `src/constructFrom/index.js`, `src/differenceInCalendarDays/index.js`, `src/differenceInCalendarMonths/index.js`, `src/differenceInCalendarYears/index.js`, `src/differenceInDays/index.js`, `src/differenceInHours/index.js`, `src/differenceInMilliseconds/index.js`, `src/differenceInMinutes/index.js`, `src/differenceInMonths/index.js`, `src/differenceInSeconds/index.js`, `src/differenceInYears/index.js`, `src/endOfDay/index.js`, `src/endOfMonth/index.js`, `src/formatISODuration/index.js`, `src/isLastDayOfMonth/index.js`, `src/startOfDay/index.js`, `src/toDate/index.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `pkgs/core/src/intervalToDuration/index.ts` of date-fns (https://github.com/date-fns/date-fns) at commit `717ce0a807ea4c6b540d015b5c408723175b2838`, distributed under the MIT licence (Copyright (c) 2021 Sasha Koss and Lesha Koss https://kossnocorp.mit-license.org); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/intervalToDuration/index.js` erased them.

```ts
/**
 * The {@link intervalToDuration} function options.
 */
export interface IntervalToDurationOptions extends ContextOptions<Date> {}
```
