# Implement map from remeda

`src/map.js` is the JavaScript build of `packages/remeda/src/map.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `map`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates a new array populated with the results of calling a provided function
 * on every element in the calling array. Equivalent to `Array.prototype.map`.
 *
 * @param data - The array to map.
 * @param callbackfn - A function to execute for each element in the array. Its
 * return value is added as a single element in the new array.
 * @returns A new array with each element being the result of the callback
 * function.
 * @signature
 *    map(data, callbackfn)
 * @example
 *    map([1, 2, 3], multiply(2)); // => [2, 4, 6]
 *    map([0, 0], add(1)); // => [1, 1]
 *    map([0, 0], (value, index) => value + index); // => [0, 1]
 * @dataFirst
 * @lazy
 * @category Array
 */
export function map(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/add.js`, `src/constant.js`, `src/difference.js`, `src/drop.js`, `src/evolve.js`, `src/filter.js`, `src/find.js`, `src/first.js`, `src/flat.js`, `src/hasAtLeast.js`, `src/identity.js`, `src/internal/lazyDataLastImpl.js`, `src/internal/purryFromLazy.js`, `src/internal/purryOrderRules.js`, `src/internal/toSingle.js`, `src/internal/utilityEvaluators.js`, `src/intersection.js`, `src/isDefined.js`, `src/isIncludedIn.js`, `src/isNot.js`, `src/isNullish.js`, `src/isStrictEqual.js`, `src/isString.js`, `src/length.js`, `src/mapValues.js`, `src/mapWithFeedback.js`, `src/multiply.js`, `src/omit.js`, `src/pipe.js`, `src/prop.js`, `src/purry.js`, `src/range.js`, `src/reduce.js`, `src/set.js`, `src/sliceString.js`, `src/sortBy.js`, `src/take.js`, `src/tap.js`, `src/times.js`, `src/when.js`, `src/zip.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/map.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
