# Implement uncapitalize from string-ts

`src/utils/word-case/uncapitalize.js` is the JavaScript build of `src/utils/word-case/uncapitalize.ts` from string-ts (https://github.com/gustavoguichard/string-ts at commit 7850efd6baba, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `uncapitalize`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Uncapitalizes the first letter of a string. This is a runtime counterpart of `Uncapitalize<T>` from `src/types.d.ts`.
 * @param str the string to uncapitalize.
 * @returns the uncapitalized string.
 * @example uncapitalize('Hello world') // 'hello world'
 */
export function uncapitalize<T extends string>(str: T)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/fixtures.js`, `src/native/char-at.js`, `src/native/join.js`, `src/native/slice.js`, `src/native/to-lower-case.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/utils/word-case/uncapitalize.ts` of string-ts (https://github.com/gustavoguichard/string-ts) at commit `7850efd6baba551d60e4b85a2e4a8ed075167bb5`, distributed under the MIT licence (Copyright (c) 2023 Gustavo Guichard); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
