# Implement merge from remeda

`src/merge.js` is the JavaScript build of `packages/remeda/src/merge.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `merge`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Merges two objects into one by combining their properties, effectively
 * creating a new object that incorporates elements from both. The merge
 * operation prioritizes the second object's properties, allowing them to
 * overwrite those from the first object with the same names.
 *
 * Equivalent to `{ ...data, ...source }`.
 *
 * @param data - The destination object, serving as the basis for the merge.
 * Properties from this object are included in the new object, but will be
 * overwritten by properties from the source object with matching keys.
 * @param source - The source object, whose properties will be included in the
 * new object. If properties in this object share keys with properties in the
 * destination object, the values from the source object will be used in the
 * new object.
 * @returns An object fully containing `source`, and any properties from `data`
 * that don't share a name with any property in `source`.
 * @signature
 *    merge(data, source)
 * @example
 *    merge({ x: 1, y: 2 }, { y: 10, z: 2 }) // => { x: 1, y: 10, z: 2 }
 * @dataFirst
 * @category Object
 */
export function merge(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/merge.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
