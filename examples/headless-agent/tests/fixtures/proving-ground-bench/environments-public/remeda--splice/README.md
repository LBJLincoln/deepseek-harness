# Implement splice from remeda

`src/splice.js` is the JavaScript build of `packages/remeda/src/splice.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `splice`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Removes elements from an array and, optionally, inserts new elements in
 * their place.
 *
 * Related operations:
 * - `drop` - to skip past the first `n` elements.
 * - `dropLast` - to skip past the last `n` elements.
 * - `filter` - to shape the array by *value* rather than by *position*.
 * - `swapIndices` - to swap two elements by their indices.
 * - `take` - to keep only the first `n` elements.
 * - `takeLast` - to keep only the last `n` elements.
 *
 * @param data - The array to splice.
 * @param start - The index from which to start removing elements.
 * @param deleteCount - The number of elements to remove.
 * @param replacement - Elements to insert at the cutoff point.
 * @signature
 *    splice(data, start, deleteCount);
 *    splice(data, start, deleteCount, replacement);
 * @example
 *    splice([1,2,3,4,5,6,7,8], 2, 3); //=> [1,2,6,7,8]
 *    splice([1,2,3,4,5,6,7,8], 2, 3, [9, 10]); //=> [1,2,9,10,6,7,8]
 * @dataFirst
 * @category Array
 */
export function splice(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/purryOn.js`, `src/internal/utilityEvaluators.js`, `src/pipe.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/splice.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
