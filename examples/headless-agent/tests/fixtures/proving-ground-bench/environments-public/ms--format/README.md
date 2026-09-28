# Implement format from ms

`src/index.js` is the JavaScript build of `src/index.ts` from ms (https://github.com/vercel/ms at commit 4ff48cec099f, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `format`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Format the given integer as a string.
 *
 * @param ms - milliseconds
 * @param options - Options for the conversion
 * @returns The formatted string
 */
export function format(ms: number, options?: Options): string

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/index.ts` of ms (https://github.com/vercel/ms) at commit `4ff48cec099f0514c3e9bbca18706c9c21122bfb`, distributed under the MIT licence (Copyright (c) 2025 Vercel, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/index.js` erased them.

```ts
type Years = 'years' | 'year' | 'yrs' | 'yr' | 'y';

type Months = 'months' | 'month' | 'mo';

type Weeks = 'weeks' | 'week' | 'w';

type Days = 'days' | 'day' | 'd';

type Hours = 'hours' | 'hour' | 'hrs' | 'hr' | 'h';

type Minutes = 'minutes' | 'minute' | 'mins' | 'min' | 'm';

type Seconds = 'seconds' | 'second' | 'secs' | 'sec' | 's';

type Milliseconds = 'milliseconds' | 'millisecond' | 'msecs' | 'msec' | 'ms';

type Unit =
  | Years
  | Months
  | Weeks
  | Days
  | Hours
  | Minutes
  | Seconds
  | Milliseconds;

type UnitAnyCase = Capitalize<Unit> | Uppercase<Unit> | Unit;

export type StringValue =
  | `${number}`
  | `${number}${UnitAnyCase}`
  | `${number} ${UnitAnyCase}`;

interface Options {
  /**
   * Set to `true` to use verbose formatting. Defaults to `false`.
   */
  long?: boolean;
}
```
