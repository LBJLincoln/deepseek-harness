# Implement truncate from string-ts

`src/utils/truncate.js` is the JavaScript build of `src/utils/truncate.ts` from string-ts (https://github.com/gustavoguichard/string-ts at commit 7850efd6baba, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `truncate`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * A strongly typed function to truncate a string if it's longer than the given maximum string length.
 * The last characters of the truncated string are replaced with the omission string which defaults to "...".
 * @param sentence the sentence to extract the words from.
 * @param length the maximum length of the string.
 * @param omission the string to append to the end of the truncated string.
 * @returns the truncated string
 * @example truncate('Hello, World', 8) // 'Hello...'
 */
export function truncate<
  T extends string,
  S extends number,
  P extends string = '...',
>(sentence: T, length: S, omission = '...' as P)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/native/join.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/utils/truncate.ts` of string-ts (https://github.com/gustavoguichard/string-ts) at commit `7850efd6baba551d60e4b85a2e4a8ed075167bb5`, distributed under the MIT licence (Copyright (c) 2023 Gustavo Guichard); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/utils/truncate.js` erased them.

```ts
/**
 * Truncate a string if it's longer than the given maximum length.
 * The last characters of the truncated string are replaced with the omission string which defaults to "...".
 */
export type Truncate<
  T extends string,
  Size extends number,
  Omission extends string = '...',
> = All<[IsStringLiteral<T | Omission>, IsNumberLiteral<Size>]> extends true
  ? Math.IsNegative<Size> extends true
    ? Omission
    : Math.Subtract<Length<T>, Size> extends 0
      ? T
      : Join<[Slice<T, 0, Math.Subtract<Size, Length<Omission>>>, Omission]>
  : string
```
