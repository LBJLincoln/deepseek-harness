# Implement mergeWith from es-toolkit

`src/object/mergeWith.js` is the JavaScript build of `src/object/mergeWith.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `mergeWith`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Merges the properties of the source object into the target object.
 *
 * You can provide a custom `merge` function to control how properties are merged. It should return the value to be set in the target object.
 *
 * If it returns `undefined`, a default deep merge will be applied for arrays and objects:
 *
 * - If a property in the source object is an array or an object and the corresponding property in the target object is also an array or object, they will be merged.
 * - If a property in the source object is undefined, it will not overwrite a defined property in the target object.
 *
 * Note that this function mutates the target object.
 *
 * @param target - The target object into which the source object properties will be merged. This object is modified in place.
 * @param source - The source object whose properties will be merged into the target object.
 * @param merge - A custom merge function that defines how properties should be combined. It receives the following arguments:
 *   - `targetValue`: The current value of the property in the target object.
 *   - `sourceValue`: The value of the property in the source object.
 *   - `key`: The key of the property being merged.
 *   - `target`: The target object.
 *   - `source`: The source object.
 *
 * @returns The updated target object with properties from the source object merged in.
 *
 * @template T - Type of the target object.
 * @template S - Type of the source object.
 *
 * @example
 * const target = { a: 1, b: 2 };
 * const source = { b: 3, c: 4 };
 *
 * mergeWith(target, source, (targetValue, sourceValue) => {
 *   if (typeof targetValue === 'number' && typeof sourceValue === 'number') {
 *     return targetValue + sourceValue;
 *   }
 * });
 * // Returns { a: 1, b: 5, c: 4 }
 * @example
 * const target = { a: [1], b: [2] };
 * const source = { a: [3], b: [4] };
 *
 * const result = mergeWith(target, source, (objValue, srcValue) => {
 *   if (Array.isArray(objValue)) {
 *     return objValue.concat(srcValue);
 *   }
 * });
 *
 * expect(result).toEqual({ a: [1, 3], b: [2, 4] });
 */
export function mergeWith<T extends Record<PropertyKey, any>, S extends Record<PropertyKey, any>>(
  target: T,
  source: S,
  merge: (targetValue: any, sourceValue: any, key: string, target: T, source: S) => any
): T & S

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/_internal/globalThis.js`, `src/_internal/isMergeableValue.js`, `src/_internal/isUnsafeProperty.js`, `src/compat/_internal/getSymbols.js`, `src/compat/_internal/getTag.js`, `src/compat/_internal/tags.js`, `src/object/cloneDeep.js`, `src/object/cloneDeepWith.js`, `src/predicate/isBuffer.js`, `src/predicate/isPlainObject.js`, `src/predicate/isPrimitive.js`, `src/predicate/isTypedArray.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/object/mergeWith.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
