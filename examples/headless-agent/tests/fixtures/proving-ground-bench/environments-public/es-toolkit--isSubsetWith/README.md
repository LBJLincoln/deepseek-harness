# Implement isSubsetWith from es-toolkit

`src/array/isSubsetWith.js` is the JavaScript build of `src/array/isSubsetWith.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `isSubsetWith`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Checks if the `subset` array is entirely contained within the `superset` array based on a custom equality function.
 *
 * This function takes two arrays and a custom comparison function. It returns a boolean indicating
 * whether all elements in the subset array are present in the superset array, as determined by the provided
 * custom equality function.
 *
 * @template T - The type of elements contained in the arrays.
 * @param superset - The array that may contain all elements of the subset.
 * @param subset - The array to check against the superset.
 * @param areItemsEqual - A function to determine if two items are equal.
 * @returns Returns `true` if all elements of the subset are present in the superset
 * according to the custom equality function, otherwise returns `false`.
 *
 * @example
 * ```typescript
 * const superset = [{ id: 1 }, { id: 2 }, { id: 3 }];
 * const subset = [{ id: 2 }, { id: 1 }];
 * const areItemsEqual = (a, b) => a.id === b.id;
 * isSubsetWith(superset, subset, areItemsEqual); // true
 * ```
 *
 * @example
 * ```typescript
 * const superset = [{ id: 1 }, { id: 2 }, { id: 3 }];
 * const subset = [{ id: 4 }];
 * const areItemsEqual = (a, b) => a.id === b.id;
 * isSubsetWith(superset, subset, areItemsEqual); // false
 * ```
 */
export function isSubsetWith<T>(
  superset: readonly T[],
  subset: readonly T[],
  areItemsEqual: (x: T, y: T) => boolean
): boolean

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/array/differenceWith.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/isSubsetWith.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
