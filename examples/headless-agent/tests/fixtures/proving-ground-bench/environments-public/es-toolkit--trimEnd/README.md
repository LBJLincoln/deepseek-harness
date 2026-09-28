# Implement trimEnd from es-toolkit

`src/string/trimEnd.js` is the JavaScript build of `src/string/trimEnd.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `trimEnd`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Removes trailing whitespace or specified characters from a string.
 *
 * If `chars` is a string, it should be a single character. To trim a string with multiple characters,
 * provide an array instead.
 *
 * @param str - The string from which trailing characters will be trimmed.
 * @param chars - The character(s) to remove from the end of the string.
 * @returns The resulting string after the specified trailing character has been removed.
 *
 * @example
 * const trimmedStr1 = trimEnd('hello---', '-') // returns 'hello'
 * const trimmedStr2 = trimEnd('123000', '0') // returns '123'
 * const trimmedStr3 = trimEnd('abcabcabc', 'c') // returns 'abcabcab'
 * const trimmedStr4 = trimEnd('trimmedxxx', 'x') // returns 'trimmed'
 */
export function trimEnd(str: string, chars?: string | string[]): string

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/string/trimEnd.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
