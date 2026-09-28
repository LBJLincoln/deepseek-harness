# Implement delay from es-toolkit

`src/promise/delay.js` is the JavaScript build of `src/promise/delay.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `delay`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Delays the execution of code for a specified number of milliseconds.
 *
 * This function returns a Promise that resolves after the specified delay, allowing you to use it
 * with async/await to pause execution.
 *
 * @param ms - The number of milliseconds to delay.
 * @param options - The options object.
 * @param options.signal - An optional AbortSignal to cancel the delay.
 * @returns A Promise that resolves after the specified delay.
 *
 * @example
 * async function foo() {
 *   console.log('Start');
 *   await delay(1000); // Delays execution for 1 second
 *   console.log('End');
 * }
 *
 * foo();
 *
 * // With AbortSignal
 * const controller = new AbortController();
 * const { signal } = controller;
 *
 * setTimeout(() => controller.abort(), 50); // Will cancel the delay after 50ms
 * try {
 *   await delay(100, { signal });
 *  } catch (error) {
 *   console.error(error); // Will log 'AbortError'
 *  }
 * }
 */
export function delay(ms: number, { signal }: DelayOptions = {}): Promise<void>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/_internal/DOMException.js`, `src/_internal/globalThis.js`, `src/array/filterAsync.js`, `src/array/flatMapAsync.js`, `src/array/flatten.js`, `src/array/forEachAsync.js`, `src/array/mapAsync.js`, `src/array/reduceAsync.js`, `src/error/AbortError.js`, `src/error/TimeoutError.js`, `src/function/debounce.js`, `src/function/throttle.js`, `src/object/mapKeysAsync.js`, `src/object/mapValuesAsync.js`, `src/promise/limitAsync.js`, `src/promise/mutex.js`, `src/promise/semaphore.js`, `src/promise/timeout.js`, `src/promise/withTimeout.js`, `src/util/attempt.js`, `src/util/attemptAsync.js`, `src/util/deferAsync.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/promise/delay.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/promise/delay.js` erased them.

```ts
interface DelayOptions {
  signal?: AbortSignal;
}
```
