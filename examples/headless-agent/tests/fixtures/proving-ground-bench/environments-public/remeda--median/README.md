# Implement median from remeda

`src/median.js` is the JavaScript build of `packages/remeda/src/median.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `median`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Returns the median of the elements of an array.
 *
 * Only `number` arrays are supported, as `bigint` is unable to represent fractional values.
 *
 * IMPORTANT: The result for empty arrays would be `undefined`, regardless of
 * the type of the array. This approach improves type-checking and ensures that
 * cases where `NaN` might occur are handled properly. To avoid adding this to
 * the return type for cases where the array is known to be non-empty you can use
 * `hasAtLeast` or `isEmpty` to guard against this case.
 *
 * @param data - The array of numbers.
 * @signature
 *   median(data);
 * @example
 *   pipe([6, 10, 11], median()); // => 10
 *   median([]); // => undefined
 * @dataFirst
 * @category Number
 */
export function median(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/pipe.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/median.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/median.js` erased them.

```ts
type Median<T extends IterableContainer<number>> =
  | (T extends readonly [] ? never : number)
  | (T extends readonly [unknown, ...unknown[]] ? never : undefined);
```
