# Implement charAt from string-ts

`src/native/char-at.js` is the JavaScript build of `src/native/char-at.ts` from string-ts (https://github.com/gustavoguichard/string-ts at commit 7850efd6baba, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `charAt`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * A strongly-typed version of `String.prototype.charAt`.
 * @param str the string to get the character from.
 * @param index the index of the character.
 * @returns the character in both type level and runtime.
 * @example charAt('hello world', 6) // 'w'
 */
export function charAt<T extends string, I extends number>(
  str: T,
  index: I
): CharAt<T, I>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/native/char-at.ts` of string-ts (https://github.com/gustavoguichard/string-ts) at commit `7850efd6baba551d60e4b85a2e4a8ed075167bb5`, distributed under the MIT licence (Copyright (c) 2023 Gustavo Guichard); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/native/char-at.js` erased them.

```ts
/**
 * Gets the character at the given index.
 * T: The string to get the character from.
 * index: The index of the character.
 */
export type CharAt<T extends string, index extends number> = All<
  [IsStringLiteral<T>, IsNumberLiteral<index>]
> extends true
  ? Split<T>[index]
  : string
```
