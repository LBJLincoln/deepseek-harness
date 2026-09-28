# Implement toMerged from es-toolkit

`src/object/toMerged.js` is the JavaScript build of `src/object/toMerged.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `toMerged`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Merges the properties of the source object into a deep clone of the target object.
 * Unlike `merge`, This function does not modify the original target object.
 *
 * This function performs a deep merge, meaning nested objects and arrays are merged recursively.
 *
 * - If a property in the source object is an array or object and the corresponding property in the target object is also an array or object, they will be merged.
 * - If a property in the source object is undefined, it will not overwrite a defined property in the target object.
 *
 * Note that this function does not mutate the target object.
 *
 * @param target - The target object to be cloned and merged into. This object is not modified directly.
 * @param source - The source object whose properties will be merged into the cloned target object.
 * @returns A new object with properties from the source object merged into a deep clone of the target object.
 *
 * @template T - Type of the target object.
 * @template S - Type of the source object.
 *
 * @example
 * const target = { a: 1, b: { x: 1, y: 2 } };
 * const source = { b: { y: 3, z: 4 }, c: 5 };
 *
 * const result = toMerged(target, source);
 * console.log(result);
 * // Output: { a: 1, b: { x: 1, y: 3, z: 4 }, c: 5 }
 *
 * @example
 * const target = { a: [1, 2], b: { x: 1 } };
 * const source = { a: [3], b: { y: 2 } };
 *
 * const result = toMerged(target, source);
 * console.log(result);
 * // Output: { a: [3, 2], b: { x: 1, y: 2 } }
 *
 * @example
 * const target = { a: null };
 * const source = { a: [1, 2, 3] };
 *
 * const result = toMerged(target, source);
 * console.log(result);
 * // Output: { a: [1, 2, 3] }
 */
export function toMerged<T extends Record<PropertyKey, any>, S extends Record<PropertyKey, any>>(
  target: T,
  source: S
): T & S

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/_internal/globalThis.js`, `src/_internal/isMergeableValue.js`, `src/_internal/isUnsafeProperty.js`, `src/compat/_internal/getSymbols.js`, `src/compat/_internal/getTag.js`, `src/compat/_internal/tags.js`, `src/object/clone.js`, `src/object/cloneDeep.js`, `src/object/cloneDeepWith.js`, `src/object/mergeWith.js`, `src/predicate/isBuffer.js`, `src/predicate/isPlainObject.js`, `src/predicate/isPrimitive.js`, `src/predicate/isTypedArray.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/object/toMerged.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
