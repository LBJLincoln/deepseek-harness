# Implement mapToObj from remeda

`src/mapToObj.js` is the JavaScript build of `packages/remeda/src/mapToObj.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `mapToObj`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Map each element of an array into an object using a defined mapper that
 * converts each item into an object entry (a tuple of `[<key>, <value>]`).
 *
 * There are several other functions that could be used to build an object from
 * an array:
 * - `fromKeys` - Builds an object from an array of *keys* and a mapper for
 * values.
 * - `indexBy` - Builds an object from an array of *values* and a mapper for
 * keys.
 * - `pullObject` - Builds an object from an array of items with a mapper for
 * values and another mapper for keys.
 * - `fromEntries` - Builds an object from an array of key-value pairs.
 *
 * **Warning**: We strongly advise against using this function unless it is
 * used with a huge input array and your app has stringent memory/gc
 * constraints. We recommend that in most cases you should use `pullObject`,
 * or the composition `fromEntries(map(array, fn))`. This function will be
 * deprecated and **removed** in future versions of the library!
 *
 * @param array - The array to map.
 * @param fn - The mapping function, which should return a tuple of [key, value], similar to Object.fromEntries.
 * @returns The new mapped object.
 * @signature
 *    mapToObj(array, fn)
 * @example
 *    mapToObj([1, 2, 3], x => [String(x), x * 2]) // => {1: 2, 2: 4, 3: 6}
 * @dataFirst
 * @category Array
 */
export function mapToObj(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/pipe.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/mapToObj.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
