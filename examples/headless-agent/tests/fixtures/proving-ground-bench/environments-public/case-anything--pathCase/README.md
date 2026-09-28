# Implement pathCase from case-anything

`src/core.js` is the JavaScript build of `src/core.ts` from case-anything (https://github.com/mesqueeb/case-anything at commit b0e95907e6a8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `pathCase`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * # 📂 Path/case
 *
 * Converts a string to path/case
 *
 * - Adds slashes, does not change casing
 * - _keeps_ special characters by default
 *
 * @example
 *   pathCase('$catDog') === '$cat/Dog'
 *
 * @example
 *   pathCase('$catDog', { keepSpecialCharacters: false }) === 'cat/Dog'
 */
export function pathCase(
  string: string,
  options: { keepSpecialCharacters?: boolean; keep?: string[] } = { keepSpecialCharacters: true },
): string

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/utils.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/core.ts` of case-anything (https://github.com/mesqueeb/case-anything) at commit `b0e95907e6a81c0417915db3bd1c910a706fd666`, distributed under the MIT licence (Copyright (c) 2019 Luca Ban - Mesqueeb); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
