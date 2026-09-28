# Implement flattenDeep from es-toolkit

`src/array/flattenDeep.js` is the JavaScript build of `src/array/flattenDeep.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `flattenDeep`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Flattens all depths of a nested array.
 *
 * @template T - The type of elements within the array.
 * @param arr - The array to flatten.
 * @returns A new array that has been flattened.
 *
 * @example
 * const arr = flattenDeep([1, [2, [3]], [4, [5, 6]]]);
 * // Returns: [1, 2, 3, 4, 5, 6]
 */
export function flattenDeep<T>(arr: readonly T[]): Array<ExtractNestedArrayType<T>>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/array/flatten.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/flattenDeep.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/array/flattenDeep.js` erased them.

```ts
/**
 * Utility type for recursively unpacking nested array types to extract the type of the innermost element
 *
 * @example
 * ExtractNestedArrayType<(number | (number | number[])[])[]>
 * // number
 *
 * ExtractNestedArrayType<(boolean | (string | number[])[])[]>
 * // string | number | boolean
 */
export type ExtractNestedArrayType<T> = T extends ReadonlyArray<infer U> ? ExtractNestedArrayType<U> : T;
```
