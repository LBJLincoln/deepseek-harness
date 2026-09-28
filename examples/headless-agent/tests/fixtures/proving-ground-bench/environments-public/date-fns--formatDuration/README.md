# Implement formatDuration from date-fns

`src/formatDuration/index.js` is the JavaScript build of `pkgs/core/src/formatDuration/index.ts` from date-fns (https://github.com/date-fns/date-fns at commit 717ce0a807ea, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `formatDuration`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * @name formatDuration
 * @category Common Helpers
 * @summary Formats a duration in human-readable format
 *
 * @description
 * Return human-readable duration string i.e. "9 months 2 days"
 *
 * @param duration - The duration to format
 * @param options - An object with options.
 *
 * @returns The formatted date string
 *
 * @example
 * // Format full duration
 * formatDuration({
 *   years: 2,
 *   months: 9,
 *   weeks: 1,
 *   days: 7,
 *   hours: 5,
 *   minutes: 9,
 *   seconds: 30
 * })
 * //=> '2 years 9 months 1 week 7 days 5 hours 9 minutes 30 seconds'
 *
 * @example
 * // Format partial duration
 * formatDuration({ months: 9, days: 2 })
 * //=> '9 months 2 days'
 *
 * @example
 * // Customize the format
 * formatDuration(
 *   {
 *     years: 2,
 *     months: 9,
 *     weeks: 1,
 *     days: 7,
 *     hours: 5,
 *     minutes: 9,
 *     seconds: 30
 *   },
 *   { format: ['months', 'weeks'] }
 * ) === '9 months 1 week'
 *
 * @example
 * // Customize the zeros presence
 * formatDuration({ years: 0, months: 9 })
 * //=> '9 months'
 * formatDuration({ years: 0, months: 9 }, { zero: true })
 * //=> '0 years 9 months'
 *
 * @example
 * // Customize the delimiter
 * formatDuration({ years: 2, months: 9, weeks: 3 }, { delimiter: ', ' })
 * //=> '2 years, 9 months, 3 weeks'
 */
export function formatDuration(
  duration: Duration,
  options?: FormatDurationOptions,
): string

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/_lib/defaultLocale/index.js`, `src/_lib/defaultOptions/index.js`, `src/locale/_lib/buildFormatLongFn/index.js`, `src/locale/_lib/buildLocalizeFn/index.js`, `src/locale/_lib/buildMatchFn/index.js`, `src/locale/_lib/buildMatchPatternFn/index.js`, `src/locale/en-US/_lib/formatDistance/index.js`, `src/locale/en-US/_lib/formatLong/index.js`, `src/locale/en-US/_lib/formatRelative/index.js`, `src/locale/en-US/_lib/localize/index.js`, `src/locale/en-US/_lib/match/index.js`, `src/locale/en-US/index.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `pkgs/core/src/formatDuration/index.ts` of date-fns (https://github.com/date-fns/date-fns) at commit `717ce0a807ea4c6b540d015b5c408723175b2838`, distributed under the MIT licence (Copyright (c) 2021 Sasha Koss and Lesha Koss https://kossnocorp.mit-license.org); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/formatDuration/index.js` erased them.

```ts
/**
 * The {@link formatDuration} function options.
 */
export interface FormatDurationOptions extends LocalizedOptions<"formatDistance"> {
  /** The array of units to format */
  format?: DurationUnit[];
  /** Should be zeros be included in the output? */
  zero?: boolean;
  /** The delimiter string to use */
  delimiter?: string;
}
```
