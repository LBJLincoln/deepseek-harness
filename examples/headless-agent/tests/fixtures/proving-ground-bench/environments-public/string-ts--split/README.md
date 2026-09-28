# Implement split from string-ts

`src/native/split.js` is the JavaScript build of `src/native/split.ts` from string-ts (https://github.com/gustavoguichard/string-ts at commit 7850efd6baba, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `split`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * A strongly-typed version of `String.prototype.split`.
 * @param str the string to split.
 * @param delimiter the delimiter.
 * @returns the splitted string in both type level and runtime.
 * @example split('hello world', ' ') // ['hello', 'world']
 */
export function split<T extends string, D extends string = ''>(
  str: T,
  delimiter: D = '' as D
)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/native/split.ts` of string-ts (https://github.com/gustavoguichard/string-ts) at commit `7850efd6baba551d60e4b85a2e4a8ed075167bb5`, distributed under the MIT licence (Copyright (c) 2023 Gustavo Guichard); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/native/split.js` erased them.

```ts
/**
 * Splits a string into an array of substrings.
 * T: The string to split.
 * delimiter: The delimiter.
 */
export type Split<
  T extends string,
  delimiter extends string = '',
> = IsStringLiteral<T | delimiter> extends true
  ? T extends `${infer first}${delimiter}${infer rest}`
    ? [first, ...Split<rest, delimiter>]
    : T extends ''
      ? []
      : [T]
  : string[]
```
