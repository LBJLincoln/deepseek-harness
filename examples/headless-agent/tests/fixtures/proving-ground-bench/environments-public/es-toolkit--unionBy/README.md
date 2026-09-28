# Implement unionBy from es-toolkit

`src/array/unionBy.js` is the JavaScript build of `src/array/unionBy.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `unionBy`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates an array of unique values, in order, from all given arrays using a provided mapping function to determine equality.
 *
 * @template T - The type of elements in the array.
 * @template U - The type of mapped elements.
 * @param arr1 - The first array.
 * @param arr2 - The second array.
 * @param mapper - The function to map array elements to comparison values.
 * @returns A new array containing the union of unique elements from `arr1` and `arr2`, based on the values returned by the mapping function.
 *
 * @example
 * // Custom mapping function for numbers (modulo comparison)
 * const moduloMapper = (x) => x % 3;
 * unionBy([1, 2, 3], [4, 5, 6], moduloMapper);
 * // Returns [1, 2, 3]
 *
 * @example
 * // Custom mapping function for objects with an 'id' property
 * const idMapper = (obj) => obj.id;
 * unionBy([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }], idMapper);
 * // Returns [{ id: 1 }, { id: 2 }, { id: 3 }]
 */
export function unionBy<T, U>(arr1: readonly T[], arr2: readonly T[], mapper: (item: T) => U): T[]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/array/uniqBy.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/unionBy.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
