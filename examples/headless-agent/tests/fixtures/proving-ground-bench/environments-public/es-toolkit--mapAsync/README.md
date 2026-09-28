# Implement mapAsync from es-toolkit

`src/array/mapAsync.js` is the JavaScript build of `src/array/mapAsync.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `mapAsync`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Transforms each element in an array using an async callback function and returns
 * a promise that resolves to an array of transformed values.
 *
 * @template T - The type of elements in the input array.
 * @template R - The type of elements in the output array.
 * @param array The array to transform.
 * @param callback An async function that transforms each element.
 * @param [options] Optional configuration object.
 * @param [options.concurrency] Maximum number of concurrent async operations. If not specified, all operations run concurrently.
 * @returns A promise that resolves to an array of transformed values.
 * @example
 * const users = [{ id: 1 }, { id: 2 }, { id: 3 }];
 * const userDetails = await mapAsync(users, async (user) => {
 *   return await fetchUserDetails(user.id);
 * });
 * // Returns: [{ id: 1, name: '...' }, { id: 2, name: '...' }, { id: 3, name: '...' }]
 *
 * @example
 * // With concurrency limit
 * const numbers = [1, 2, 3, 4, 5];
 * const results = await mapAsync(
 *   numbers,
 *   async (n) => await slowOperation(n),
 *   { concurrency: 2 }
 * );
 * // Processes at most 2 operations concurrently
 */
export function mapAsync<T, R>(
  array: readonly T[],
  callback: (item: T, index: number, array: readonly T[]) => Promise<R>,
  options?: MapAsyncOptions
): Promise<R[]>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/_internal/DOMException.js`, `src/_internal/globalThis.js`, `src/error/AbortError.js`, `src/promise/delay.js`, `src/promise/limitAsync.js`, `src/promise/semaphore.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/mapAsync.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/array/mapAsync.js` erased them.

```ts
interface MapAsyncOptions {
  concurrency?: number;
}
```
