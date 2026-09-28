# Implement xorBy from es-toolkit

`src/array/xorBy.js` is the JavaScript build of `src/array/xorBy.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `xorBy`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Computes the symmetric difference between two arrays using a custom mapping function.
 * The symmetric difference is the set of elements which are in either of the arrays,
 * but not in their intersection, determined by the result of the mapping function.
 *
 * @template T - Type of elements in the input arrays.
 * @template U - Type of the values returned by the mapping function.
 *
 * @param arr1 - The first array.
 * @param arr2 - The second array.
 * @param mapper - The function to map array elements to comparison values.
 * @returns An array containing the elements that are present in either `arr1` or `arr2` but not in both, based on the values returned by the mapping function.
 *
 * @example
 * // Custom mapping function for objects with an 'id' property
 * const idMapper = obj => obj.id;
 * xorBy([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }], idMapper);
 * // Returns [{ id: 1 }, { id: 3 }]
 */
export function xorBy<T, U>(arr1: readonly T[], arr2: readonly T[], mapper: (item: T) => U): T[]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/array/differenceBy.js`, `src/array/intersectionBy.js`, `src/array/unionBy.js`, `src/array/uniqBy.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/xorBy.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
