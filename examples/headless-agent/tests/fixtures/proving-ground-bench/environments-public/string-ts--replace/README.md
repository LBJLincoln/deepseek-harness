# Implement replace from string-ts

`src/native/replace.js` is the JavaScript build of `src/native/replace.ts` from string-ts (https://github.com/gustavoguichard/string-ts at commit 7850efd6baba, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `replace`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * A strongly-typed version of `String.prototype.replace`.
 * @param sentence the sentence to replace.
 * @param lookup the lookup string to be replaced.
 * @param replacement the replacement string.
 * @returns the replaced string in both type level and runtime.
 * @example replace('hello world', 'l', '1') // 'he1lo world'
 */
export function replace<
  T extends string,
  S extends string | RegExp,
  R extends string = '',
>(sentence: T, lookup: S, replacement: R = '' as R)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/native/replace.ts` of string-ts (https://github.com/gustavoguichard/string-ts) at commit `7850efd6baba551d60e4b85a2e4a8ed075167bb5`, distributed under the MIT licence (Copyright (c) 2023 Gustavo Guichard); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/native/replace.js` erased them.

```ts
/**
 * Replaces the first occurrence of a string with another string.
 * sentence: The sentence to replace.
 * lookup: The lookup string to be replaced.
 * replacement: The replacement string.
 */
export type Replace<
  sentence extends string,
  lookup extends string | RegExp,
  replacement extends string = '',
> = lookup extends string
  ? IsStringLiteral<lookup | sentence | replacement> extends true
    ? sentence extends `${infer rest}${lookup}${infer rest2}`
      ? `${rest}${replacement}${rest2}`
      : sentence
    : string
  : string
```
