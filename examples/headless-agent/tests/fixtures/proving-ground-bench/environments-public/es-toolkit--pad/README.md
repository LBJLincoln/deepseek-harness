# Implement pad from es-toolkit

`src/string/pad.js` is the JavaScript build of `src/string/pad.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `pad`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Pads string on the left and right sides if it's shorter than length. Padding characters are truncated if they can't be evenly divided by length.
 * If the length is less than or equal to the original string's length, or if the padding character is an empty string, the original string is returned unchanged.
 *
 * @param str - The string to pad.
 * @param [length] - The length of the resulting string once padded.
 * @param [chars] - The character(s) to use for padding.
 * @returns The padded string, or the original string if padding is not required.
 *
 * @example
 * const result1 = pad('abc', 8);         // result will be '  abc   '
 * const result2 = pad('abc', 8, '_-');   // result will be '_-abc_-_'
 * const result3 = pad('abc', 3);         // result will be 'abc'
 * const result4 = pad('abc', 2);         // result will be 'abc'
 *
 */
export function pad(str: string, length: number, chars = ' '): string

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/string/pad.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
