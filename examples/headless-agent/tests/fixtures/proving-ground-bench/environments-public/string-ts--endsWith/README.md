# Implement endsWith from string-ts

`src/native/ends-with.js` is the JavaScript build of `src/native/ends-with.ts` from string-ts (https://github.com/gustavoguichard/string-ts at commit 7850efd6baba, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `endsWith`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * A strongly-typed version of `String.prototype.endsWith`.
 * @param text the string to search.
 * @param search the string to search with.
 * @param position the index the search should end at.
 * @returns boolean, whether or not the text string ends with the search string.
 * @example endsWith('abc', 'c') // true
 */
export function endsWith<
  T extends string,
  S extends string,
  P extends number = Length<T>,
>(text: T, search: S, position = text.length as P)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/native/ends-with.ts` of string-ts (https://github.com/gustavoguichard/string-ts) at commit `7850efd6baba551d60e4b85a2e4a8ed075167bb5`, distributed under the MIT licence (Copyright (c) 2023 Gustavo Guichard); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/native/ends-with.js` erased them.

```ts
/**
 * Checks if a string ends with another string.
 * T: The string to check.
 * S: The string to check against.
 * P: The position the search should end.
 */
export type EndsWith<
  T extends string,
  S extends string,
  P extends number | undefined = undefined,
> = P extends number ? _EndsWith<T, S, P> : _EndsWithNoPosition<T, S>

type _EndsWith<T extends string, S extends string, P extends number> = All<
  [IsStringLiteral<S>, IsNumberLiteral<P>]
> extends true
  ? Math.IsNegative<P> extends false
    ? P extends Length<T>
      ? IsStringLiteral<T> extends true
        ? S extends Slice<T, Math.Subtract<Length<T>, Length<S>>, Length<T>>
          ? true
          : false
        : _EndsWithNoPosition<Slice<T, 0, P>, S> // Eg: EndsWith<`abc${string}xyz`, 'c', 3>
      : _EndsWithNoPosition<Slice<T, 0, P>, S> // P !== T.length, slice
    : false // P is negative, false
  : boolean

/** Overload of EndsWith without P */
type _EndsWithNoPosition<T extends string, S extends string> = StartsWith<
  Reverse<T>,
  Reverse<S>
>
```
