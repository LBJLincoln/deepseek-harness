# Implement sliceString from remeda

`src/sliceString.js` is the JavaScript build of `packages/remeda/src/sliceString.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `sliceString`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Extracts a section of a string between two indices.
 *
 * This function is a wrapper around the built-in [`String.prototype.slice`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/slice)
 * method.
 *
 * @param data - The string to extract from.
 * @param indexStart - The index of the first character to include in the
 * returned substring.
 * @param indexEnd - The index of the first character to exclude from the
 * returned substring.
 * @returns A new string containing the extracted section of the string.
 * @signature
 *    sliceString(data, indexStart, indexEnd)
 * @example
 *    sliceString("abcdefghijkl", 1) // => `bcdefghijkl`
 *    sliceString("abcdefghijkl", 4, 7) // => `efg`
 * @dataFirst
 * @category String
 */
export function sliceString(
  dataOrIndexStart: number | string,
  indexStartOrIndexEnd?: number,
  indexEnd?: number,
): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/add.js`, `src/constant.js`, `src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/map.js`, `src/pipe.js`, `src/purry.js`, `src/times.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/sliceString.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
