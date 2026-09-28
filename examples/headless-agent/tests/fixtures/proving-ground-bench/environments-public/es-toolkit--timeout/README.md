# Implement timeout from es-toolkit

`src/promise/timeout.js` is the JavaScript build of `src/promise/timeout.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `timeout`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Returns a promise that rejects with a `TimeoutError` after a specified delay.
 *
 * You can pass an `AbortSignal` to cancel the timeout. Unlike most `AbortSignal`-aware
 * APIs, aborting does **not** reject the promise. A `timeout` only exists to lose a
 * `Promise.race`, so cancelling it leaves the promise pending forever, allowing the
 * operation it guards to settle on its own. The underlying timer and abort listener
 * are cleared on abort, so nothing is leaked.
 *
 * @param ms - The delay duration in milliseconds.
 * @param options - The options object.
 * @param options.signal - An optional AbortSignal to cancel the timeout. When aborted, the returned promise never settles.
 * @returns A promise that rejects with a `TimeoutError` after the specified delay, or never settles if aborted.
 * @throws {TimeoutError} Throws a `TimeoutError` after the specified delay.
 *
 * @example
 * try {
 *   await timeout(1000); // Timeout exception after 1 second
 * } catch (error) {
 *   console.error(error); // Will log 'The operation was timed out'
 * }
 *
 * @example
 * // Cancelling the timeout lifts the time limit instead of throwing.
 * const controller = new AbortController();
 * setTimeout(() => controller.abort(), 50);
 *
 * const result = await Promise.race([
 *   doWork(),
 *   timeout(1000, { signal: controller.signal }), // never rejects once aborted
 * ]);
 */
export function timeout(ms: number, { signal }: TimeoutOptions = {}): Promise<never>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/_internal/DOMException.js`, `src/_internal/globalThis.js`, `src/error/AbortError.js`, `src/error/TimeoutError.js`, `src/promise/delay.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/promise/timeout.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/promise/timeout.js` erased them.

```ts
interface TimeoutOptions {
  signal?: AbortSignal;
}
```
