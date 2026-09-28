# Implement forEachAsync from es-toolkit

`src/array/forEachAsync.js` is the JavaScript build of `src/array/forEachAsync.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `forEachAsync`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Executes an async callback function for each element in an array.
 *
 * Unlike the native `forEach`, this function returns a promise that resolves
 * when all async operations complete. It supports optional concurrency limiting.
 *
 * @template T - The type of elements in the array.
 * @param array The array to iterate over.
 * @param callback An async function to execute for each element.
 * @param [options] Optional configuration object.
 * @param [options.concurrency] Maximum number of concurrent async operations. If not specified, all operations run concurrently.
 * @returns A promise that resolves when all operations complete.
 * @example
 * const users = [{ id: 1 }, { id: 2 }, { id: 3 }];
 * await forEachAsync(users, async (user) => {
 *   await updateUser(user.id);
 * });
 * // All users have been updated
 *
 * @example
 * // With concurrency limit
 * const items = [1, 2, 3, 4, 5];
 * await forEachAsync(
 *   items,
 *   async (item) => await processItem(item),
 *   { concurrency: 2 }
 * );
 * // Processes at most 2 items concurrently
 */
export async function forEachAsync<T>(
  array: readonly T[],
  callback: (item: T, index: number, array: readonly T[]) => Promise<void>,
  options?: ForEachAsyncOptions
): Promise<void>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/_internal/DOMException.js`, `src/_internal/globalThis.js`, `src/error/AbortError.js`, `src/promise/delay.js`, `src/promise/limitAsync.js`, `src/promise/semaphore.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/forEachAsync.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/array/forEachAsync.js` erased them.

```ts
interface ForEachAsyncOptions {
  concurrency?: number;
}
```
