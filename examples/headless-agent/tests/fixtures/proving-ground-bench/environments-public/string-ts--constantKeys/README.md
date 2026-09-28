# Implement constantKeys from string-ts

`src/utils/object-keys/constant-keys.js` is the JavaScript build of `src/utils/object-keys/constant-keys.ts` from string-ts (https://github.com/gustavoguichard/string-ts at commit 7850efd6baba, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `constantKeys`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * A strongly typed function that shallowly transforms the keys of an object to CONSTANT_CASE. The transformation is done both at runtime and type level.
 * @param obj the object to transform.
 * @returns the transformed object.
 * @example constantKeys({ 'foo-bar': { 'fizz-buzz': true } }) // { FOO_BAR: { 'fizz-buzz': true } }
 */
export function constantKeys<T>(obj: T): ConstantKeys<T>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/internals.js`, `src/native/char-at.js`, `src/native/join.js`, `src/native/replace-all.js`, `src/native/slice.js`, `src/native/to-lower-case.js`, `src/native/to-upper-case.js`, `src/utils/characters/apostrophe.js`, `src/utils/characters/separators.js`, `src/utils/object-keys/transform-keys.js`, `src/utils/word-case/capitalize.js`, `src/utils/word-case/constant-case.js`, `src/utils/word-case/delimiter-case.js`, `src/utils/words.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/utils/object-keys/constant-keys.ts` of string-ts (https://github.com/gustavoguichard/string-ts) at commit `7850efd6baba551d60e4b85a2e4a8ed075167bb5`, distributed under the MIT licence (Copyright (c) 2023 Gustavo Guichard); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/utils/object-keys/constant-keys.js` erased them.

```ts
/**
 * Shallowly transforms the keys of a Record to CONSTANT_CASE.
 * T: the type of the Record to transform.
 */
export type ConstantKeys<T> = T extends []
  ? T
  : { [K in keyof T as ConstantCase<Extract<K, string>>]: T[K] }
```
