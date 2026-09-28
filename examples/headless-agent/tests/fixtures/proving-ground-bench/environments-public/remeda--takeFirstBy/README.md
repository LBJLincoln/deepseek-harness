# Implement takeFirstBy from remeda

`src/takeFirstBy.js` is the JavaScript build of `packages/remeda/src/takeFirstBy.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `takeFirstBy`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Take the first `n` items from `data` based on the provided ordering criteria. This allows you to avoid sorting the array before taking the items. The complexity of this function is *O(Nlogn)* where `N` is the length of the array.
 *
 * For the opposite operation (to drop `n` elements) see `dropFirstBy`.
 *
 * @param data - The input array.
 * @param n - The number of items to take. If `n` is non-positive no items would be returned, if `n` is bigger then data.length a *clone* of `data` would be returned.
 * @param rules - A variadic array of order rules defining the sorting criteria. Each order rule is a projection function that extracts a comparable value from the data. Sorting is based on these extracted values using the native `<` and `>` operators. Earlier rules take precedence over later ones. Use the syntax `[projection, "desc"]` for descending order.
 * @returns A subset of the input array.
 * @signature
 *   takeFirstBy(data, n, ...rules);
 * @example
 *   takeFirstBy(['aa', 'aaaa', 'a', 'aaa'], 2, x => x.length); // => ['aa', 'a']
 * @dataFirst
 * @category Array
 */
export function takeFirstBy(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/hasAtLeast.js`, `src/identity.js`, `src/internal/heap.js`, `src/internal/lazyDataLastImpl.js`, `src/internal/purryOrderRules.js`, `src/internal/swapInPlace.js`, `src/internal/utilityEvaluators.js`, `src/pipe.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/takeFirstBy.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
