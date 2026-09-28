# Implement startsWith from string-ts

`src/native/starts-with.js` is the JavaScript build of `src/native/starts-with.ts` from string-ts (https://github.com/gustavoguichard/string-ts at commit 7850efd6baba, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `startsWith`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * A strongly-typed version of `String.prototype.startsWith`.
 * @param text the string to search.
 * @param search the string to search with.
 * @param position the index to start search at.
 * @returns boolean, whether or not the text string starts with the search string.
 * @example startsWith('abc', 'a') // true
 */
export function startsWith<
  T extends string,
  S extends string,
  P extends number = 0,
>(text: T, search: S, position = 0 as P)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/native/starts-with.ts` of string-ts (https://github.com/gustavoguichard/string-ts) at commit `7850efd6baba551d60e4b85a2e4a8ed075167bb5`, distributed under the MIT licence (Copyright (c) 2023 Gustavo Guichard); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/native/starts-with.js` erased them.

```ts
/**
 * Checks if a string starts with another string.
 * T: The string to check.
 * S: The string to check against.
 * P: The position to start the search.
 */
export type StartsWith<
  T extends string,
  S extends string,
  P extends number = 0,
> = All<[IsStringLiteral<S>, IsNumberLiteral<P>]> extends true
  ? Math.IsNegative<P> extends false
    ? P extends 0
      ? S extends `${infer SHead}${infer SRest}`
        ? T extends `${infer THead}${infer TRest}`
          ? IsStringLiteral<THead | SHead> extends true
            ? THead extends SHead
              ? StartsWith<TRest, SRest>
              : false // Heads weren't equal
            : boolean // THead is non-literal
          : IsStringLiteral<T> extends true // Couldn't split T
            ? false // T ran out, but we still have S
            : boolean // T (or TRest) is not a literal
        : true // Couldn't split S, we've already ruled out non-literal
      : StartsWith<Slice<T, P>, S, 0> // P is >0, slice
    : StartsWith<T, S, 0> // P is negative, ignore it
  : boolean
```
