# Implement cloneDeep from es-toolkit

`src/object/cloneDeep.js` is the JavaScript build of `src/object/cloneDeep.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `cloneDeep`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates a deep clone of the given object.
 *
 * @template T - The type of the object.
 * @param obj - The object to clone.
 * @returns A deep clone of the given object.
 *
 * @example
 * // Clone a primitive value
 * const num = 29;
 * const clonedNum = cloneDeep(num);
 * console.log(clonedNum); // 29
 * console.log(clonedNum === num); // true
 *
 * @example
 * // Clone an array
 * const arr = [1, 2, 3];
 * const clonedArr = cloneDeep(arr);
 * console.log(clonedArr); // [1, 2, 3]
 * console.log(clonedArr === arr); // false
 *
 * @example
 * // Clone an array with nested objects
 * const arr = [1, { a: 1 }, [1, 2, 3]];
 * const clonedArr = cloneDeep(arr);
 * arr[1].a = 2;
 * console.log(arr); // [1, { a: 2 }, [1, 2, 3]]
 * console.log(clonedArr); // [1, { a: 1 }, [1, 2, 3]]
 * console.log(clonedArr === arr); // false
 *
 * @example
 * // Clone an object
 * const obj = { a: 1, b: 'es-toolkit', c: [1, 2, 3] };
 * const clonedObj = cloneDeep(obj);
 * console.log(clonedObj); // { a: 1, b: 'es-toolkit', c: [1, 2, 3] }
 * console.log(clonedObj === obj); // false
 *
 * @example
 * // Clone an object with nested objects
 * const obj = { a: 1, b: { c: 1 } };
 * const clonedObj = cloneDeep(obj);
 * obj.b.c = 2;
 * console.log(obj); // { a: 1, b: { c: 2 } }
 * console.log(clonedObj); // { a: 1, b: { c: 1 } }
 * console.log(clonedObj === obj); // false
 */
export function cloneDeep<T>(obj: T): T

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/_internal/globalThis.js`, `src/_internal/isMergeableValue.js`, `src/_internal/isUnsafeProperty.js`, `src/compat/_internal/getSymbols.js`, `src/compat/_internal/getTag.js`, `src/compat/_internal/tags.js`, `src/object/cloneDeepWith.js`, `src/object/mergeWith.js`, `src/predicate/isBuffer.js`, `src/predicate/isPlainObject.js`, `src/predicate/isPrimitive.js`, `src/predicate/isTypedArray.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/object/cloneDeep.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
