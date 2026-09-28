# Implement isEqualWith from es-toolkit

`src/predicate/isEqualWith.js` is the JavaScript build of `src/predicate/isEqualWith.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `isEqualWith`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Compares two values for equality using a custom comparison function.
 *
 * The custom function allows for fine-tuned control over the comparison process. If it returns a boolean, that result determines the equality. If it returns undefined, the function falls back to the default equality comparison.
 *
 * This function also uses the custom equality function to compare values inside objects,
 * arrays, maps, sets, and other complex structures, ensuring a deep comparison.
 *
 * This approach provides flexibility in handling complex comparisons while maintaining efficient default behavior for simpler cases.
 *
 * The custom comparison function can take up to six parameters:
 * - `x`: The value from the first object `a`.
 * - `y`: The value from the second object `b`.
 * - `property`: The property key used to get `x` and `y`.
 * - `xParent`: The parent of the first value `x`.
 * - `yParent`: The parent of the second value `y`.
 * - `stack`: An internal stack (Map) to handle circular references.
 *
 * @param a - The first value to compare.
 * @param b - The second value to compare.
 * @param areValuesEqual - A function to customize the comparison.
 *   If it returns a boolean, that result will be used. If it returns undefined,
 *   the default equality comparison will be used.
 * @returns `true` if the values are equal according to the customizer, otherwise `false`.
 *
 * @example
 * const customizer = (a, b) => {
 *   if (typeof a === 'string' && typeof b === 'string') {
 *     return a.toLowerCase() === b.toLowerCase();
 *   }
 * };
 * isEqualWith('Hello', 'hello', customizer); // true
 * isEqualWith({ a: 'Hello' }, { a: 'hello' }, customizer); // true
 * isEqualWith([1, 2, 3], [1, 2, 3], customizer); // true
 */
export function isEqualWith(
  a: any,
  b: any,
  areValuesEqual: (
    x: any,
    y: any,
    property?: PropertyKey,
    xParent?: any,
    yParent?: any,
    stack?: Map<any, any>
  ) => boolean | void
): boolean

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/_internal/globalThis.js`, `src/compat/_internal/args.js`, `src/compat/_internal/arrayViews.js`, `src/compat/_internal/getSymbols.js`, `src/compat/_internal/getTag.js`, `src/compat/_internal/tags.js`, `src/compat/_internal/toArgs.js`, `src/compat/_internal/typedArrays.js`, `src/compat/util/eq.js`, `src/compat/util/stubFalse.js`, `src/function/noop.js`, `src/predicate/isBuffer.js`, `src/predicate/isPlainObject.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/predicate/isEqualWith.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
