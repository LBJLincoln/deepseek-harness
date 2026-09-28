# Implement upperCase from es-toolkit

`src/string/upperCase.js` is the JavaScript build of `src/string/upperCase.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `upperCase`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Converts a string to upper case.
 *
 * Upper case is the naming convention in which each word is written in uppercase and separated by an space ( ) character.
 *
 * @param str - The string that is to be changed to upper case.
 * @returns The converted string to upper case.
 *
 * @example
 * const convertedStr1 = upperCase('camelCase') // returns 'CAMEL CASE'
 * const convertedStr2 = upperCase('some whitespace') // returns 'SOME WHITESPACE'
 * const convertedStr3 = upperCase('hyphen-text') // returns 'HYPHEN TEXT'
 * const convertedStr4 = upperCase('HTTPRequest') // returns 'HTTP REQUEST'
 */
export function upperCase(str: string): string

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/string/words.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/string/upperCase.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
