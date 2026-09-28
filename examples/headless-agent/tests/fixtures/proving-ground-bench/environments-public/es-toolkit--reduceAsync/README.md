# Implement reduceAsync from es-toolkit

`src/array/reduceAsync.js` is the JavaScript build of `src/array/reduceAsync.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `reduceAsync`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Reduces an array to a single value using an async reducer function.
 *
 * Applies the reducer function sequentially to each element (left to right),
 * carrying an accumulated result from one call to the next. Unlike other async
 * array methods, reduce must process elements sequentially and does not support
 * concurrency limiting.
 *
 * @template T - The type of elements in the array.
 * @template U - The type of the accumulated result.
 * @param array The array to reduce.
 * @param reducer An async function that processes each element.
 * @param initialValue The initial value of the accumulator.
 * @returns A promise that resolves to the final accumulated value.
 * @example
 * const numbers = [1, 2, 3, 4, 5];
 * const sum = await reduceAsync(
 *   numbers,
 *   async (acc, n) => acc + await fetchValue(n),
 *   0
 * );
 * // Returns: sum of all fetched values
 *
 * @example
 * const users = [{ id: 1 }, { id: 2 }, { id: 3 }];
 * const userMap = await reduceAsync(
 *   users,
 *   async (acc, user) => {
 *     const details = await fetchUserDetails(user.id);
 *     acc[user.id] = details;
 *     return acc;
 *   },
 *   {} as Record<number, any>
 * );
 * // Returns: { 1: {...}, 2: {...}, 3: {...} }
 */
export async function reduceAsync<T, U>(
  array: readonly T[],
  reducer: (accumulator: U, currentValue: T, currentIndex: number, array: readonly T[]) => Promise<U>,
  initialValue?: U
): Promise<U>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/_internal/DOMException.js`, `src/_internal/globalThis.js`, `src/error/AbortError.js`, `src/promise/delay.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/reduceAsync.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
