# Implement cloneDeepWith from es-toolkit

`src/object/cloneDeepWith.js` is the JavaScript build of `src/object/cloneDeepWith.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `cloneDeepWith`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Deeply clones the given object.
 *
 * You can customize the deep cloning process using the `cloneValue` function.
 * The function takes the current value `value`, the property name `key`, and the entire object `obj` as arguments.
 * If the function returns a value, that value is used;
 * if it returns `undefined`, the default cloning method is used.
 *
 * @template T - The type of the object.
 * @param obj - The object to clone.
 * @param [cloneValue] - A function to customize the cloning process.
 * @returns A deep clone of the given object.
 *
 * @example
 * // Clone a primitive value
 * const num = 29;
 * const clonedNum = cloneDeepWith(num);
 * console.log(clonedNum); // 29
 * console.log(clonedNum === num); // true
 *
 * @example
 * // Clone an object with a customizer
 * const obj = { a: 1, b: 2 };
 * const clonedObj = cloneDeepWith(obj, (value) => {
 *   if (typeof value === 'number') {
 *     return value * 2; // Double the number
 *   }
 * });
 * console.log(clonedObj); // { a: 2, b: 4 }
 * console.log(clonedObj === obj); // false
 *
 * @example
 * // Clone an array with a customizer
 * const arr = [1, 2, 3];
 * const clonedArr = cloneDeepWith(arr, (value) => {
 *   if (typeof value === 'number') {
 *     return value + 1; // Increment each number
 *   }
 * });
 * console.log(clonedArr); // [2, 3, 4]
 * console.log(clonedArr === arr); // false
 */
export function cloneDeepWith<T>(
  obj: T,
  cloneValue: (value: any, key: PropertyKey | undefined, obj: T, stack: Map<any, any>) => any
): T

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/_internal/globalThis.js`, `src/compat/_internal/getSymbols.js`, `src/compat/_internal/getTag.js`, `src/compat/_internal/tags.js`, `src/function/noop.js`, `src/predicate/isBuffer.js`, `src/predicate/isPrimitive.js`, `src/predicate/isTypedArray.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/object/cloneDeepWith.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
