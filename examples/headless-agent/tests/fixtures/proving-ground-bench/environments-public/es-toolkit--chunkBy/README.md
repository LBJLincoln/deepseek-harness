# Implement chunkBy from es-toolkit

`src/array/chunkBy.js` is the JavaScript build of `src/array/chunkBy.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `chunkBy`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Splits an array into chunks of consecutive elements that share the same key.
 *
 * Walking left to right, each element's key is derived by `iteratee`. Whenever
 * the key differs from the previous element's key, a new chunk is started;
 * otherwise the element is appended to the current chunk. Keys are compared with
 * `!==` (strict inequality), so equal primitives stay together while distinct
 * object references always start a new chunk.
 *
 * Unlike {@link chunk}, which splits by a fixed size, `chunkBy` splits by a
 * boundary condition, keeping runs of same-keyed elements together.
 *
 * @template T - The type of elements in the array.
 * @param arr - The array to split into chunks.
 * @param iteratee - A function that derives the comparison key for each element.
 * @returns A two-dimensional array where each sub-array is a run of consecutive
 *   elements that produced the same key.
 *
 * @example
 * // Group consecutive equal numbers
 * chunkBy([1, 1, 2, 3, 3, 3], value => value);
 * // Returns: [[1, 1], [2], [3, 3, 3]]
 *
 * @example
 * // Group consecutive words by their length
 * chunkBy(['a', 'b', 'cd', 'ef', 'g'], word => word.length);
 * // Returns: [['a', 'b'], ['cd', 'ef'], ['g']]
 */
export function chunkBy<T>(arr: readonly T[], iteratee: (value: T) => unknown): T[][]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/chunkBy.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
