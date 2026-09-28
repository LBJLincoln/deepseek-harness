# Implement partition from es-toolkit

`src/array/partition.js` is the JavaScript build of `src/array/partition.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `partition`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Splits an array into two groups based on a predicate function.
 *
 * This function takes an array and a predicate function. It returns a tuple of two arrays:
 * the first array contains elements for which the predicate function returns true, and
 * the second array contains elements for which the predicate function returns false.
 *
 * @template T - The type of elements in the array.
 * @template {T} U - The type being filtered for.
 * @param arr - The array to partition.
 * @param isInTruthy - A type guard that determines whether an
 * element should be placed in the truthy array. The function is called with each element
 * of the array and its index.
 * @returns A tuple containing two arrays: the first array contains elements for
 * which the predicate returned true, and the second array contains elements for which the
 * predicate returned false.
 *
 * @example
 * const array = [1, 2, 3, 4] as const;
 * const isEven = (x: number): x is 2 | 4 => x % 2 === 0;
 * const [even, odd]: [(2 | 4)[], (2 | 4)[]] = partition(array, isEven);
 * // even will be [2, 4], and odd will be [1, 3]
 */
export function partition<T>(
  arr: readonly T[],
  isInTruthy: (value: T, index: number, array: readonly T[]) => unknown
): [truthy: T[], falsy: T[]]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/partition.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
