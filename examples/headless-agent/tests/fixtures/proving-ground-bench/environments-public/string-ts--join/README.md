# Implement join from string-ts

`src/native/join.js` is the JavaScript build of `src/native/join.ts` from string-ts (https://github.com/gustavoguichard/string-ts at commit 7850efd6baba, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `join`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * A strongly-typed version of `Array.prototype.join`.
 * @param tuple the tuple of strings to join.
 * @param delimiter the delimiter.
 * @returns the joined string in both type level and runtime.
 * @example join(['hello', 'world'], '-') // 'hello-world'
 */
export function join<const T extends readonly string[], D extends string = ''>(
  tuple: T,
  delimiter: D = '' as D
)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/native/join.ts` of string-ts (https://github.com/gustavoguichard/string-ts) at commit `7850efd6baba551d60e4b85a2e4a8ed075167bb5`, distributed under the MIT licence (Copyright (c) 2023 Gustavo Guichard); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/native/join.js` erased them.

```ts
/**
 * Joins a tuple of strings with the given delimiter.
 * T: The tuple of strings to join.
 * delimiter: The delimiter.
 */
export type Join<
  T extends readonly string[],
  delimiter extends string = '',
> = All<[IsStringLiteralArray<T>, IsStringLiteral<delimiter>]> extends true
  ? T extends readonly [
      infer first extends string,
      ...infer rest extends string[],
    ]
    ? rest extends []
      ? first
      : `${first}${delimiter}${Join<rest, delimiter>}`
    : ''
  : string
```
