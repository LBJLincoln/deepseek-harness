# Implement withTimeout from es-toolkit

`src/promise/withTimeout.js` is the JavaScript build of `src/promise/withTimeout.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `withTimeout`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Executes an async function and enforces a timeout.
 *
 * If the promise does not resolve within the specified time,
 * the timeout will trigger and the returned promise will be rejected.
 *
 * You can pass an `AbortSignal` to cancel the timeout. Aborting the signal lifts the
 * time limit: the timeout stops counting and `run`'s promise is awaited without a
 * deadline. It does not reject the returned promise or abort `run` itself — pass the
 * same signal into `run` if you also want to cancel the underlying work.
 *
 * @template T
 * @param run - A function that returns a promise to be executed.
 * @param ms - The timeout duration in milliseconds.
 * @param options - The options object.
 * @param options.signal - An optional AbortSignal to cancel the timeout. When aborted, the time limit is lifted.
 * @returns A promise that resolves with the result of the `run` function or rejects if the timeout is reached.
 *
 * @example
 * async function fetchData() {
 *   const response = await fetch('https://example.com/data');
 *   return response.json();
 * }
 *
 * try {
 *   const data = await withTimeout(fetchData, 1000);
 *   console.log(data); // Logs the fetched data if `fetchData` is resolved within 1 second.
 * } catch (error) {
 *   console.error(error); // Will log 'TimeoutError' if `fetchData` is not resolved within 1 second.
 * }
 *
 * @example
 * // Lift the time limit when the user opts to keep waiting.
 * const controller = new AbortController();
 * keepWaitingButton.onclick = () => controller.abort();
 *
 * const data = await withTimeout(fetchData, 1000, { signal: controller.signal });
 */
export async function withTimeout<T>(
  run: () => Promise<T>,
  ms: number,
  { signal }: WithTimeoutOptions = {}
): Promise<T>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/_internal/DOMException.js`, `src/_internal/globalThis.js`, `src/error/AbortError.js`, `src/error/TimeoutError.js`, `src/promise/delay.js`, `src/promise/timeout.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/promise/withTimeout.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/promise/withTimeout.js` erased them.

```ts
interface WithTimeoutOptions {
  signal?: AbortSignal;
}
```
