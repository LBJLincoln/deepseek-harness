# Implement typeOf from string-ts

`src/internal/internals.js` is the JavaScript build of `src/internal/internals.ts` from string-ts (https://github.com/gustavoguichard/string-ts at commit 7850efd6baba, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `typeOf`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * This is an enhanced version of the typeof operator to check the type of more complex values.
 * In this case we just mind about arrays and objects. We can add more on demand.
 * @param t the value to be checked
 * @returns the type of the value
 */
function typeOf(t: unknown)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/native/char-at.js`, `src/native/join.js`, `src/native/slice.js`, `src/native/to-lower-case.js`, `src/native/to-upper-case.js`, `src/utils/word-case/capitalize.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/internal/internals.ts` of string-ts (https://github.com/gustavoguichard/string-ts) at commit `7850efd6baba551d60e4b85a2e4a8ed075167bb5`, distributed under the MIT licence (Copyright (c) 2023 Gustavo Guichard); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/internal/internals.js` erased them.

```ts
/**
 * PascalCases all the words in a tuple of strings
 */
type PascalCaseAll<T extends string[]> = T extends [
  infer head extends string,
  ...infer rest extends string[],
]
  ? [Capitalize<Lowercase<head>>, ...PascalCaseAll<rest>]
  : T

/**
 * Removes all the elements matching the given condition from a tuple.
 */
type Reject<tuple, cond, output extends any[] = []> = tuple extends [
  infer first,
  ...infer rest,
]
  ? Reject<rest, cond, first extends cond ? output : [...output, first]>
  : output

/**
 * Removes the given suffix from a sentence.
 */
type DropSuffix<sentence extends string, suffix extends string> = string extends
  | sentence
  | suffix
  ? string
  : sentence extends `${infer rest}${suffix}`
    ? rest
    : sentence

/**
 * Returns a tuple of the given length with the given type.
 */
type TupleOf<
  L extends number,
  T = unknown,
  result extends any[] = [],
> = result['length'] extends L ? result : TupleOf<L, T, [...result, T]>
```
