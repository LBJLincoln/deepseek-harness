# Implement flatMapAsync from es-toolkit

`src/array/flatMapAsync.js` is the JavaScript build of `src/array/flatMapAsync.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `flatMapAsync`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Maps each element in an array using an async callback function and flattens the result by one level.
 *
 * This is equivalent to calling `mapAsync` followed by `flat(1)`, but more efficient.
 * Each callback should return an array, and all returned arrays are concatenated into
 * a single output array.
 *
 * @template T - The type of elements in the input array.
 * @template R - The type of elements in the arrays returned by the callback.
 * @param array The array to transform.
 * @param callback An async function that transforms each element into an array.
 * @param [options] Optional configuration object.
 * @param [options.concurrency] Maximum number of concurrent async operations. If not specified, all operations run concurrently.
 * @returns A promise that resolves to a flattened array of transformed values.
 * @example
 * const users = [{ id: 1 }, { id: 2 }];
 * const allPosts = await flatMapAsync(users, async (user) => {
 *   return await fetchUserPosts(user.id);
 * });
 * // Returns: [post1, post2, post3, ...] (all posts from all users)
 *
 * @example
 * // With concurrency limit
 * const numbers = [1, 2, 3];
 * const results = await flatMapAsync(
 *   numbers,
 *   async (n) => await fetchRelatedItems(n),
 *   { concurrency: 2 }
 * );
 * // Processes at most 2 operations concurrently
 */
export async function flatMapAsync<T, R>(
  array: readonly T[],
  callback: (item: T, index: number, array: readonly T[]) => Promise<R[]>,
  options?: FlatMapAsyncOptions
): Promise<R[]>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/_internal/DOMException.js`, `src/_internal/globalThis.js`, `src/array/flatten.js`, `src/error/AbortError.js`, `src/promise/delay.js`, `src/promise/limitAsync.js`, `src/promise/semaphore.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/flatMapAsync.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/array/flatMapAsync.js` erased them.

```ts
interface FlatMapAsyncOptions {
  concurrency?: number;
}
```
