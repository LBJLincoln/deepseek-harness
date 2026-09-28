# Implement formatISODuration from date-fns

`src/formatISODuration/index.js` is the JavaScript build of `pkgs/core/src/formatISODuration/index.ts` from date-fns (https://github.com/date-fns/date-fns at commit 717ce0a807ea, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `formatISODuration`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * @name formatISODuration
 * @category Common Helpers
 * @summary Format a duration object according as ISO 8601 duration string
 *
 * @description
 * Format a duration object according to the ISO 8601 duration standard (https://www.digi.com/resources/documentation/digidocs//90001488-13/reference/r_iso_8601_duration_format.htm)
 *
 * @param duration - The duration to format
 *
 * @returns The ISO 8601 duration string
 *
 * @example
 * // Format the given duration as ISO 8601 string
 * const result = formatISODuration({
 *   years: 39,
 *   months: 2,
 *   days: 20,
 *   hours: 7,
 *   minutes: 5,
 *   seconds: 0
 * })
 * //=> 'P39Y2M20DT0H0M0S'
 */
export function formatISODuration(duration: Duration): string

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/_lib/getRoundingMethod/index.js`, `src/_lib/getTimezoneOffsetInMilliseconds/index.js`, `src/_lib/normalizeDates/index.js`, `src/_lib/normalizeInterval/index.js`, `src/add/index.js`, `src/addDays/index.js`, `src/addMonths/index.js`, `src/compareAsc/index.js`, `src/constants/index.js`, `src/constructFrom/index.js`, `src/differenceInCalendarDays/index.js`, `src/differenceInCalendarMonths/index.js`, `src/differenceInCalendarYears/index.js`, `src/differenceInDays/index.js`, `src/differenceInHours/index.js`, `src/differenceInMilliseconds/index.js`, `src/differenceInMinutes/index.js`, `src/differenceInMonths/index.js`, `src/differenceInSeconds/index.js`, `src/differenceInYears/index.js`, `src/endOfDay/index.js`, `src/endOfMonth/index.js`, `src/intervalToDuration/index.js`, `src/isLastDayOfMonth/index.js`, `src/startOfDay/index.js`, `src/toDate/index.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `pkgs/core/src/formatISODuration/index.ts` of date-fns (https://github.com/date-fns/date-fns) at commit `717ce0a807ea4c6b540d015b5c408723175b2838`, distributed under the MIT licence (Copyright (c) 2021 Sasha Koss and Lesha Koss https://kossnocorp.mit-license.org); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
