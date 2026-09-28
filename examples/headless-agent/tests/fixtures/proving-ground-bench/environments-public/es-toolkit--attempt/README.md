# Implement attempt from es-toolkit

`src/util/attempt.js` is the JavaScript build of `src/util/attempt.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `attempt`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Attempt to execute a function and return the result or error.
 * Returns a tuple where:
 * - On success: [null, Result] - First element is null, second is the result
 * - On error: [Error, null] - First element is the caught error, second is null
 *
 * @template {unknown} T - The type of the result of the function.
 * @template {unknown} E - The type of the error that can be thrown by the function.
 * @param func - The function to execute.
 * @returns A tuple containing either [null, result] or [error, null].
 *
 * @example
 * // Successful execution
 * const [error, result] = attempt(() => 42);
 * // [null, 42]
 *
 * // Failed execution
 * const [error, result] = attempt(() => {
 *   throw new Error('Something went wrong');
 * });
 * // [Error, null]
 *
 * // With type parameter
 * const [error, names] = attempt<string[]>(() => ['Alice', 'Bob']);
 * // [null, ['Alice', 'Bob']]
 *
 * @note
 * Important: This function is not suitable for async functions (functions that return a `Promise`).
 * When passing an async function, it will return `[null, Promise<Result>]`, but won't catch any
 * errors if the Promise is rejected later.
 *
 * For handling async functions, use the `attemptAsync` function instead:
 * ```
 * const [error, data] = await attemptAsync(async () => {
 *   const response = await fetch('https://api.example.com/data');
 *   return response.json();
 * });
 * ```
 */
export function attempt<T, E = unknown>(func: () => T): [null, T] | [E, null]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/_internal/DOMException.js`, `src/_internal/globalThis.js`, `src/error/AbortError.js`, `src/promise/delay.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/util/attempt.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
