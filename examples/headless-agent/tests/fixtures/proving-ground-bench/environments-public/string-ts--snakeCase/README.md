# Implement snakeCase from string-ts

`src/utils/word-case/snake-case.js` is the JavaScript build of `src/utils/word-case/snake-case.ts` from string-ts (https://github.com/gustavoguichard/string-ts at commit 7850efd6baba, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `snakeCase`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * A strongly typed version of `snakeCase` that works in both runtime and type level.
 * @param str the string to convert to snake case.
 * @returns the snake cased string.
 * @example snakeCase('hello world') // 'hello_world'
 */
export function snakeCase<T extends string>(str: T): SnakeCase<T>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/fixtures.js`, `src/native/join.js`, `src/native/replace-all.js`, `src/native/to-lower-case.js`, `src/utils/characters/apostrophe.js`, `src/utils/characters/separators.js`, `src/utils/word-case/delimiter-case.js`, `src/utils/words.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/utils/word-case/snake-case.ts` of string-ts (https://github.com/gustavoguichard/string-ts) at commit `7850efd6baba551d60e4b85a2e4a8ed075167bb5`, distributed under the MIT licence (Copyright (c) 2023 Gustavo Guichard); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/utils/word-case/snake-case.js` erased them.

```ts
/**
 * Transforms a string to snake_case.
 */
export type SnakeCase<T extends string> = Lowercase<
  DelimiterCase<RemoveApostrophe<T>, '_'>
>
```
