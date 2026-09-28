# Implement repeat from string-ts

`src/native/repeat.js` is the JavaScript build of `src/native/repeat.ts` from string-ts (https://github.com/gustavoguichard/string-ts at commit 7850efd6baba, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `repeat`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * A strongly-typed version of `String.prototype.repeat`.
 * @param str the string to repeat.
 * @param times the number of times to repeat.
 * @returns the repeated string in both type level and runtime.
 * For counts above 45 the return type falls back to `string`.
 * @example repeat('hello', 3) // 'hellohellohello'
 */
export function repeat<T extends string, N extends number = 0>(
  str: T,
  times: N = 0 as N
)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/native/repeat.ts` of string-ts (https://github.com/gustavoguichard/string-ts) at commit `7850efd6baba551d60e4b85a2e4a8ed075167bb5`, distributed under the MIT licence (Copyright (c) 2023 Gustavo Guichard); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/native/repeat.js` erased them.

```ts
type SafeRepeatCount =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20
  | 21
  | 22
  | 23
  | 24
  | 25
  | 26
  | 27
  | 28
  | 29
  | 30
  | 31
  | 32
  | 33
  | 34
  | 35
  | 36
  | 37
  | 38
  | 39
  | 40
  | 41
  | 42
  | 43
  | 44
  | 45

/**
 * Repeats a string N times.
 * T: The string to repeat.
 * N: The number of times to repeat.
 *
 * For counts above 45 the return type falls back to `string` to avoid
 * hitting TypeScript's type-instantiation depth limit.
 */
export type Repeat<T extends string, times extends number = 0> = T extends T
  ? All<[IsStringLiteral<T>, IsNumberLiteral<times>]> extends true
    ? times extends 0
      ? ''
      : Math.IsNegative<times> extends false
        ? times extends SafeRepeatCount
          ? Join<TupleOf<times, T>>
          : string
        : never
    : string
  : never
```
