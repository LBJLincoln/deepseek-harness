# Implement unzip from es-toolkit

`src/array/unzip.js` is the JavaScript build of `src/array/unzip.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `unzip`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Gathers elements in the same position in an internal array
 * from a grouped array of elements and returns them as a new array.
 *
 * The returned array's length matches the longest nested array.
 * Missing positions in shorter arrays are filled with `undefined`.
 *
 * @template T - The type of elements in the nested array.
 * @param zipped - The nested array to unzip.
 * @returns A new array of unzipped elements.
 *
 * @example
 * const zipped = [['a', true, 1],['b', false, 2]];
 * const result = unzip(zipped);
 * // result will be [['a', 'b'], [true, false], [1, 2]]
 */
export function unzip<T extends unknown[]>(zipped: ReadonlyArray<[...T]>): Unzip<T>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/unzip.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/array/unzip.js` erased them.

```ts
type Unzip<K extends unknown[]> = { [I in keyof K]: Array<K[I]> };
```
