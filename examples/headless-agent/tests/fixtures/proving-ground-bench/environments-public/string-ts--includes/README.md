# Implement includes from string-ts

`src/native/includes.js` is the JavaScript build of `src/native/includes.ts` from string-ts (https://github.com/gustavoguichard/string-ts at commit 7850efd6baba, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `includes`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * A strongly-typed version of `String.prototype.includes`.
 * @param text the string to search
 * @param search the string to search with
 * @param position the index to start search at
 * @returns boolean, whether or not the text contains the search string.
 * @example includes('abcde', 'bcd') // true
 */
export function includes<
  T extends string,
  S extends string,
  P extends number = 0,
>(text: T, search: S, position = 0 as P)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/native/includes.ts` of string-ts (https://github.com/gustavoguichard/string-ts) at commit `7850efd6baba551d60e4b85a2e4a8ed075167bb5`, distributed under the MIT licence (Copyright (c) 2023 Gustavo Guichard); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/native/includes.js` erased them.

```ts
/**
 * Checks if a string includes another string.
 * T: The string to check.
 * S: The string to check against.
 * P: The position to start the search.
 */
export type Includes<
  T extends string,
  S extends string,
  P extends number = 0,
> = string extends T | S
  ? boolean
  : Math.IsNegative<P> extends false
    ? P extends 0
      ? T extends `${string}${S}${string}`
        ? true
        : false
      : Includes<Slice<T, P>, S, 0> // P is >0, slice
    : Includes<T, S, 0>
```
