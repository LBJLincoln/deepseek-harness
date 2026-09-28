# Implement replaceKeys from string-ts

`src/utils/object-keys/replace-keys.js` is the JavaScript build of `src/utils/object-keys/replace-keys.ts` from string-ts (https://github.com/gustavoguichard/string-ts at commit 7850efd6baba, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `replaceKeys`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * A strongly typed function that shallowly transforms the keys of an object by running the `replace` method in every key. The transformation is done both at runtime and type level.
 * @param obj the object to transform.
 * @param lookup the lookup string to be replaced.
 * @param replacement the replacement string.
 * @returns the transformed object.
 * @example replaceKeys({ 'foo-bar': { 'fizz-buzz': true } }, 'f', 'b') // { booBar: { 'fizz-buz': true } }
 */
export function replaceKeys<
  T,
  S extends string | RegExp,
  R extends string = '',
>(obj: T, lookup: S, replacement: R = '' as R): ReplaceKeys<T, S, R>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/internals.js`, `src/native/char-at.js`, `src/native/join.js`, `src/native/replace.js`, `src/native/slice.js`, `src/native/to-lower-case.js`, `src/native/to-upper-case.js`, `src/utils/object-keys/transform-keys.js`, `src/utils/word-case/capitalize.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/utils/object-keys/replace-keys.ts` of string-ts (https://github.com/gustavoguichard/string-ts) at commit `7850efd6baba551d60e4b85a2e4a8ed075167bb5`, distributed under the MIT licence (Copyright (c) 2023 Gustavo Guichard); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/utils/object-keys/replace-keys.js` erased them.

```ts
/**
 * Shallowly transforms the keys of a Record with `replace`.
 * T: the type of the Record to transform.
 */
export type ReplaceKeys<
  T,
  lookup extends string | RegExp,
  replacement extends string = '',
> = T extends []
  ? T
  : {
      [K in keyof T as Replace<Extract<K, string>, lookup, replacement>]: T[K]
    }
```
