# Implement windowed from es-toolkit

`src/array/windowed.js` is the JavaScript build of `src/array/windowed.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `windowed`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates an array of sub-arrays (windows) from the input array, each of the specified size.
 * The windows can overlap depending on the step size provided.
 *
 * By default, only full windows are included in the result, and any leftover elements that can't form a full window are ignored.
 *
 * If the `partialWindows` option is set to true in the options object, the function will also include partial windows at the end of the result.
 * Partial windows are smaller sub-arrays created when there aren't enough elements left in the input array to form a full window.
 *
 * @template T
 * @param arr - The input array to create windows from.
 * @param size - The size of each window. Must be a positive integer.
 * @param [step=1] - The step size between the start of each window. Must be a positive integer.
 * @param [options={}] - Options object to configure the behavior of the function.
 * @param [options.partialWindows=false] - Whether to include partial windows at the end of the array.
 * @returns An array of windows (sub-arrays) created from the input array.
 * @throws {Error} If the size or step is not a positive integer.
 *
 * @example
 * windowed([1, 2, 3, 4], 2);
 * // => [[1, 2], [2, 3], [3, 4]]
 *
 * @example
 * windowed([1, 2, 3, 4, 5, 6], 3, 2);
 * // => [[1, 2, 3], [3, 4, 5]]
 *
 * @example
 * windowed([1, 2, 3, 4, 5, 6], 3, 2, { partialWindows: true });
 * // => [[1, 2, 3], [3, 4, 5], [5, 6]]
 */
export function windowed<T>(
  arr: readonly T[],
  size: number,
  step = 1,
  { partialWindows = false }: WindowedOptions = {}
): T[][]

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/windowed.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/array/windowed.js` erased them.

```ts
/**
 * Options for the windowed function.
 *
 * @interface WindowedOptions
 * @property {boolean} [partialWindows=false] - Whether to include partial windows at the end of the array.
 */
export interface WindowedOptions {
  /**
   * Whether to include partial windows at the end of the array.
   *
   * By default, `windowed` only includes full windows in the result,
   * ignoring any leftover elements that can't form a full window.
   *
   * If `partialWindows` is true, the function will also include these smaller, partial windows at the end of the result.
   */
  partialWindows?: boolean;
}
```
