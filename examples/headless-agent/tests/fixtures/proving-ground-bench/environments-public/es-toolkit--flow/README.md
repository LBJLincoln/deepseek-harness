# Implement flow from es-toolkit

`src/function/flow.js` is the JavaScript build of `src/function/flow.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `flow`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates a new function that executes the given functions in sequence. The return value of the previous function is passed as an argument to the next function.
 *
 * The `this` context of the returned function is also passed to the functions provided as parameters.
 *
 * @param funcs The functions to invoke.
 * @returns Returns the new composite function.
 *
 * @example
 * const add = (x: number, y: number) => x + y;
 * const square = (n: number) => n * n;
 *
 * const combined = flow(add, square);
 * console.log(combined(1, 2)); // 9
 */
export function flow(...funcs: Array<(...args: any[]) => any>): (...args: any[]) => any

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/_internal/globalThis.js`, `src/_internal/isUnsafeProperty.js`, `src/array/head.js`, `src/array/uniq.js`, `src/compat/_internal/baseToString.js`, `src/compat/_internal/getSymbols.js`, `src/compat/_internal/getTag.js`, `src/compat/_internal/isDeepKey.js`, `src/compat/_internal/isIndex.js`, `src/compat/_internal/tags.js`, `src/compat/_internal/toKey.js`, `src/compat/array/map.js`, `src/compat/function/curry.js`, `src/compat/object/cloneDeep.js`, `src/compat/object/cloneDeepWith.js`, `src/compat/object/get.js`, `src/compat/object/has.js`, `src/compat/object/property.js`, `src/compat/predicate/isArguments.js`, `src/compat/predicate/isArrayLike.js`, `src/compat/predicate/isMatch.js`, `src/compat/predicate/isMatchWith.js`, `src/compat/predicate/isObject.js`, `src/compat/predicate/isSymbol.js`, `src/compat/predicate/matches.js`, `src/compat/predicate/matchesProperty.js`, `src/compat/util/eq.js`, `src/compat/util/iteratee.js`, `src/compat/util/toPath.js`, `src/compat/util/toString.js`, `src/function/ary.js`, `src/function/identity.js`, `src/math/range.js`, `src/object/cloneDeep.js`, `src/object/cloneDeepWith.js`, `src/predicate/isBuffer.js`, `src/predicate/isLength.js`, `src/predicate/isPrimitive.js`, `src/predicate/isTypedArray.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/function/flow.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
