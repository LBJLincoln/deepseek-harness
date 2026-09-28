# Implement objectMap from antfu-utils

`src/object.js` is the JavaScript build of `src/object.ts` from antfu-utils (https://github.com/antfu/utils at commit 91f8cf73bebd, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `objectMap`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Map key/value pairs for an object, and construct a new one
 *
 *
 * @category Object
 *
 * Transform:
 * @example
 * ```
 * objectMap({ a: 1, b: 2 }, (k, v) => [k.toString().toUpperCase(), v.toString()])
 * // { A: '1', B: '2' }
 * ```
 *
 * Swap key/value:
 * @example
 * ```
 * objectMap({ a: 1, b: 2 }, (k, v) => [v, k])
 * // { 1: 'a', 2: 'b' }
 * ```
 *
 * Filter keys:
 * @example
 * ```
 * objectMap({ a: 1, b: 2 }, (k, v) => k === 'a' ? undefined : [k, v])
 * // { b: 2 }
 * ```
 */
export function objectMap<K extends string, V, NK extends string | number | symbol = K, NV = V>(obj: Record<K, V>, fn: (key: K, value: V) => [NK, NV] | undefined): Record<NK, NV>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/base.js`, `src/guards.js`, `src/is.js`, `src/string.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/object.ts` of antfu-utils (https://github.com/antfu/utils) at commit `91f8cf73bebddae8f7ebcac82e47c9bcba9805e2`, distributed under the MIT licence (Copyright (c) 2021 Anthony Fu <https://github.com/antfu>); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
