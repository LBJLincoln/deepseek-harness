# Implement hoursToSeconds from date-fns

`src/hoursToSeconds/index.js` is the JavaScript build of `pkgs/core/src/hoursToSeconds/index.ts` from date-fns (https://github.com/date-fns/date-fns at commit 717ce0a807ea, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `hoursToSeconds`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * @name hoursToSeconds
 * @category Conversion Helpers
 * @summary Convert hours to seconds.
 *
 * @description
 * Convert a number of hours to a full number of seconds.
 *
 * @param hours - The number of hours to be converted
 *
 * @returns The number of hours converted in seconds
 *
 * @example
 * // Convert 2 hours to seconds:
 * const result = hoursToSeconds(2)
 * //=> 7200
 */
export function hoursToSeconds(hours: number): number

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/constants/index.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `pkgs/core/src/hoursToSeconds/index.ts` of date-fns (https://github.com/date-fns/date-fns) at commit `717ce0a807ea4c6b540d015b5c408723175b2838`, distributed under the MIT licence (Copyright (c) 2021 Sasha Koss and Lesha Koss https://kossnocorp.mit-license.org); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
