# Implement padEnd from string-ts

`src/native/pad-end.js` is the JavaScript build of `src/native/pad-end.ts` from string-ts (https://github.com/gustavoguichard/string-ts at commit 7850efd6baba, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `padEnd`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * A strongly-typed version of `String.prototype.padEnd`.
 * @param str the string to pad.
 * @param length the length to pad.
 * @param pad the string to pad with.
 * @returns the padded string in both type level and runtime.
 * When the required padding exceeds 45 characters the return type
 * becomes a template literal (e.g. `` `hello${string}` ``) instead of
 * an exact literal.
 * @example padEnd('hello', 10, '=') // 'hello====='
 */
export function padEnd<
  T extends string,
  N extends number = 0,
  U extends string = ' ',
>(str: T, length: N = 0 as N, pad: U = ' ' as U)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/native/pad-end.ts` of string-ts (https://github.com/gustavoguichard/string-ts) at commit `7850efd6baba551d60e4b85a2e4a8ed075167bb5`, distributed under the MIT licence (Copyright (c) 2023 Gustavo Guichard); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/native/pad-end.js` erased them.

```ts
/**
 * Pads a string at the end with another string.
 * T: The string to pad.
 * times: The number of times to pad.
 * pad: The string to pad with.
 */
export type PadEnd<
  T extends string,
  times extends number = 0,
  pad extends string = ' ',
> = All<[IsStringLiteral<T | pad>, IsNumberLiteral<times>]> extends true
  ? Math.IsNegative<times> extends false
    ? Math.Subtract<times, Length<T>> extends infer missing extends number
      ? `${T}${Slice<Repeat<pad, missing>, 0, missing>}`
      : never
    : T
  : string
```
