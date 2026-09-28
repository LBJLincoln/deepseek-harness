# Implement slice from string-ts

`src/native/slice.js` is the JavaScript build of `src/native/slice.ts` from string-ts (https://github.com/gustavoguichard/string-ts at commit 7850efd6baba, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `slice`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * A strongly-typed version of `String.prototype.slice`.
 * @param str the string to slice.
 * @param start the start index.
 * @param end the end index.
 * @returns the sliced string in both type level and runtime.
 * @example slice('hello world', 6) // 'world'
 */
export function slice<
  T extends string,
  S extends number = 0,
  E extends number | undefined = undefined,
>(str: T, start: S = 0 as S, end: E = undefined as E)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/native/slice.ts` of string-ts (https://github.com/gustavoguichard/string-ts) at commit `7850efd6baba551d60e4b85a2e4a8ed075167bb5`, distributed under the MIT licence (Copyright (c) 2023 Gustavo Guichard); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/native/slice.js` erased them.

```ts
/**
 * Slices a string from a startIndex to an endIndex.
 * T: The string to slice.
 * startIndex: The start index.
 * endIndex: The end index.
 */
export type Slice<
  T extends string,
  startIndex extends number = 0,
  endIndex extends number | undefined = undefined,
> = endIndex extends number
  ? _Slice<T, startIndex, endIndex>
  : _SliceStart<T, startIndex>

/** Slice with startIndex and endIndex */
type _Slice<
  T extends string,
  startIndex extends number,
  endIndex extends number,
  _result extends string = '',
> = IsNumberLiteral<startIndex | endIndex> extends true
  ? T extends `${infer head}${infer rest}`
    ? IsStringLiteral<head> extends true
      ? startIndex extends 0
        ? endIndex extends 0
          ? _result
          : _Slice<
              rest,
              0,
              Math.Subtract<Math.GetPositiveIndex<T, endIndex>, 1>,
              `${_result}${head}`
            >
        : _Slice<
            rest,
            Math.Subtract<Math.GetPositiveIndex<T, startIndex>, 1>,
            Math.Subtract<Math.GetPositiveIndex<T, endIndex>, 1>,
            _result
          >
      : startIndex | endIndex extends 0
        ? _result
        : string // Head is non-literal
    : IsStringLiteral<T> extends true // Couldn't be split into head/tail
      ? _result // T ran out
      : startIndex | endIndex extends 0
        ? _result // Eg: Slice<`abc${string}`, 1, 3> -> 'bc'
        : string // Head is non-literal
  : string

/** Slice with startIndex only */
type _SliceStart<
  T extends string,
  startIndex extends number,
  _result extends string = '',
> = IsNumberLiteral<startIndex> extends true
  ? T extends `${infer head}${infer rest}`
    ? IsStringLiteral<head> extends true
      ? startIndex extends 0
        ? T
        : _SliceStart<
            rest,
            Math.Subtract<Math.GetPositiveIndex<T, startIndex>, 1>,
            _result
          >
      : string
    : IsStringLiteral<T> extends true
      ? _result
      : startIndex extends 0
        ? _result
        : string
  : string
```
