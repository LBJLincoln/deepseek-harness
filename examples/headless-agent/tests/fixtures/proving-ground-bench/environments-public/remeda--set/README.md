# Implement set from remeda

`src/set.js` is the JavaScript build of `packages/remeda/src/set.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `set`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Sets the `value` at `prop` of `object`.
 *
 * To add a new property to an object, or to override its type, use `addProp`
 * instead, and to set a property within a nested object use `setPath`.
 *
 * @param obj - The target method.
 * @param prop - The property name.
 * @param value - The value to set.
 * @signature
 *    set(obj, prop, value)
 * @example
 *    set({ a: 1 }, 'a', 2) // => { a: 2 }
 * @dataFirst
 * @category Object
 */
export function set(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/add.js`, `src/constant.js`, `src/evolve.js`, `src/hasAtLeast.js`, `src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/length.js`, `src/map.js`, `src/omit.js`, `src/pipe.js`, `src/purry.js`, `src/reduce.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/set.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
