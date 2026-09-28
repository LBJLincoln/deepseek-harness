# Implement product from remeda

`src/product.js` is the JavaScript build of `packages/remeda/src/product.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `product`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Compute the product of the numbers in the array, or return 1 for an empty
 * array.
 *
 * Works for both `number` and `bigint` arrays, but not arrays that contain both
 * types.
 *
 * IMPORTANT: The result for empty arrays would be 1 (`number`) regardless of
 * the type of the array; to avoid adding this to the return type for cases
 * where the array is known to be non-empty you can use `hasAtLeast` or
 * `isEmpty` to guard against this case.
 *
 * @param data - The array of numbers.
 * @signature
 *   product(data);
 * @example
 *   product([1, 2, 3]); // => 6
 *   product([1n, 2n, 3n]); // => 6n
 *   product([]); // => 1
 * @dataFirst
 * @category Number
 */
export function product(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/pipe.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/product.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/product.js` erased them.

```ts
type Product<T extends IterableContainer<bigint> | IterableContainer<number>> =
  // Empty arrays would always result in a product of (a non-bigint) 1
  T extends readonly []
    ? 1
    : // Non-empty bigint arrays will always result in a bigint product.
      T extends readonly [bigint, ...(readonly unknown[])]
      ? bigint
      : // But an empty bigint array would result in a non-bigint 1.
        T[number] extends bigint
        ? bigint | 1
        : // Non-bigint arrays are always handled correctly.
          number;
```
