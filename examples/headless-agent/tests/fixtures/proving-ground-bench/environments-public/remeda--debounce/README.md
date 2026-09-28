# Implement debounce from remeda

`src/debounce.js` is the JavaScript build of `packages/remeda/src/debounce.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `debounce`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Wraps `func` with a debouncer object that "debounces" (delays) invocations of the function during a defined cool-down period (`waitMs`). It can be configured to invoke the function either at the start of the cool-down period, the end of it, or at both ends (`timing`).
 * It can also be configured to allow invocations during the cool-down period (`maxWaitMs`).
 * It stores the latest call's arguments so they could be used at the end of the cool-down period when invoking `func` (if configured to invoke the function at the end of the cool-down period).
 * It stores the value returned by `func` whenever its invoked. This value is returned on every call, and is accessible via the `cachedValue` property of the debouncer. Its important to note that the value might be different from the value that would be returned from running `func` with the current arguments as it is a cached value from a previous invocation.
 * **Important**: The cool-down period defines the minimum between two invocations, and not the maximum. The period will be **extended** each time a call is made until a full cool-down period has elapsed without any additional calls.
 *
 *! **DEPRECATED**: This implementation of debounce is known to have issues and might not behave as expected. It should be replaced with the `funnel` utility instead. The test file [funnel.remeda-debounce.test.ts](https://github.com/remeda/remeda/blob/main/packages/remeda/src/funnel.remeda-debounce.test.ts) offers a drop-in replacement implemented via `funnel`: copy everything between its REFERENCE START and REFERENCE END markers into your project!
 *
 * @param func - The function to debounce, the returned `call` function will have
 * the exact same signature.
 * @param options - An object allowing further customization of the debouncer:
 * - `timing?: 'leading' | 'trailing' |'both'`. The default is `'trailing'`.
 *   `leading` would result in the function being invoked at the start of the
 *   cool-down period; `trailing` would result in the function being invoked at
 *   the end of the cool-down period (using the args from the last call to the
 *   debouncer). When `both` is selected the `trailing` invocation would only
 *   take place if there were more than one call to the debouncer during the
 *   cool-down period. **DEFAULT: 'trailing'**
 * - `waitMs?: number`. The length of the cool-down period in milliseconds. The
 *   debouncer would wait until this amount of time has passed without **any**
 *   additional calls to the debouncer before triggering the end-of-cool-down-
 *   period event. When this happens, the function would be invoked (if `timing`
 *   isn't `'leading'`) and the debouncer state would be reset. **DEFAULT: 0**
 * - `maxWaitMs?: number`. The length of time since a debounced call (a call
 *   that the debouncer prevented from being invoked) was made until it would be
 *   invoked. Because the debouncer can be continually triggered and thus never
 *   reach the end of the cool-down period, this allows the function to still
 *   be invoked occasionally. IMPORTANT: This param is ignored when `timing` is
 *   `'leading'`.
 * @returns A debouncer object. The main function is `call`. In addition to it
 * the debouncer comes with the following additional functions and properties:
 * - `cancel` method to cancel delayed `func` invocations
 * - `flush` method to end the cool-down period immediately.
 * - `cachedValue` the latest return value of an invocation (if one occurred).
 * - `isPending` flag to check if there is an inflight cool-down window.
 * @signature
 *   debounce(func, options);
 * @example
 *   const debouncer = debounce(identity(), { timing: 'trailing', waitMs: 1000 });
 *   const result1 = debouncer.call(1); // => undefined
 *   const result2 = debouncer.call(2); // => undefined
 *   // after 1 second
 *   const result3 = debouncer.call(3); // => 2
 *   // after 1 second
 *   debouncer.cachedValue; // => 3
 * @dataFirst
 * @category Function
 * @deprecated This implementation of debounce is known to have issues and might
 * not behave as expected. It should be replaced with the `funnel` utility
 * instead. The test file [funnel.remeda-debounce.test.ts](https://github.com/remeda/remeda/blob/main/packages/remeda/src/funnel.remeda-debounce.test.ts)
 * offers a drop-in replacement implemented via `funnel`: copy everything
 * between its REFERENCE START and REFERENCE END markers into your project.
 * @see https://css-tricks.com/debouncing-throttling-explained-examples/
 */
export function debounce<F extends StrictFunction>(
  func: F,
  {
    waitMs,
    timing = "trailing",
    maxWaitMs,
  }: DebounceOptions & {
    readonly timing?: "both" | "leading" | "trailing";
  },
): Debouncer<F>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/constant.js`, `src/identity.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/debounce.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/debounce.js` erased them.

```ts
type Debouncer<F extends StrictFunction, IsNullable extends boolean = true> = {
  /**
   * Invoke the debounced function.
   *
   * @param args - Same as the args for the debounced function.
   * @returns The last computed value of the debounced function with the
   * latest args provided to it. If `timing` does not include `leading` then the
   * the function would return `undefined` until the first cool-down period is
   * over, otherwise the function would always return the return type of the
   * debounced function.
   */
  readonly call: (
    ...args: Parameters<F>
  ) => ReturnType<F> | (true extends IsNullable ? undefined : never);

  /**
   * Cancels any debounced functions without calling them, effectively resetting
   * the debouncer to the same state it is when initially created.
   */
  readonly cancel: () => void;

  /**
   * Similar to `cancel`, but would also trigger the `trailing` invocation if
   * the debouncer would run one at the end of the cool-down period.
   */
  readonly flush: () => ReturnType<F> | undefined;

  /**
   * Is `true` when there is an active cool-down period currently debouncing
   * invocations.
   */
  readonly isPending: boolean;

  /**
   * The last computed value of the debounced function.
   */
  readonly cachedValue: ReturnType<F> | undefined;
};

type DebounceOptions = {
  readonly waitMs?: number;
  readonly maxWaitMs?: number;
};
```
