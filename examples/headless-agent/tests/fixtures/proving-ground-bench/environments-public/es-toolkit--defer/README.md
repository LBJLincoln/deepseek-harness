# Implement defer from es-toolkit

`src/util/defer.js` is the JavaScript build of `src/util/defer.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `defer`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates a `Disposable` object that runs the given callback when it is disposed.
 *
 * Use it with `using` declarations from
 * [Explicit Resource Management](https://github.com/tc39/proposal-explicit-resource-management)
 * to ensure cleanup code runs when the enclosing scope exits, even if an error is thrown.
 *
 * For asynchronous cleanup, use {@link deferAsync} with `await using` instead.
 *
 * @param callback - The cleanup function to run on dispose.
 * @returns A `Disposable` object that invokes `callback` when disposed.
 *
 * @example
 * const logs: string[] = [];
 *
 * function run() {
 *   using cleanup = defer(() => logs.push('cleanup'));
 *   logs.push('body');
 * }
 *
 * run();
 * console.log(logs); // ['body', 'cleanup']
 */
export function defer(callback: () => void): Disposable

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/util/defer.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
