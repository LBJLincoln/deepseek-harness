# Implement reverseString from es-toolkit

`src/string/reverseString.js` is the JavaScript build of `src/string/reverseString.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `reverseString`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Reverses a given string.
 *
 * This function takes a string as input and returns a new string that is the reverse of the input.
 *
 * @param value - The string that is to be reversed.
 * @returns The reversed string.
 *
 * @example
 * const reversedStr1 = reverseString('hello') // returns 'olleh'
 * const reversedStr2 = reverseString('PascalCase') // returns 'esaClacsaP'
 * const reversedStr3 = reverseString('foo 😄 bar') // returns 'rab 😄 oof'
 */
export function reverseString(value: string): string

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/string/reverseString.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
