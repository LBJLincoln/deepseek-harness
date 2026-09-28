# Implement sumBy from remeda

`src/sumBy.js` is the JavaScript build of `packages/remeda/src/sumBy.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `sumBy`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Returns the sum of the elements of an array using the provided mapper.
 *
 * Works for both `number` and `bigint` mappers, but not mappers that return both
 * types.
 *
 * IMPORTANT: The result for empty arrays would be 0 (`number`) regardless of
 * the type of the mapper; to avoid adding this to the return type for cases
 * where the array is known to be non-empty you can use `hasAtLeast` or
 * `isEmpty` to guard against this case.
 *
 * @param callbackfn - Predicate function.
 * @signature
 *   sumBy(fn)(array)
 * @example
 *    pipe(
 *      [{a: 5}, {a: 1}, {a: 3}],
 *      sumBy(x => x.a)
 *    ) // 9
 *
 *    pipe(
 *      [{a: 5n}, {a: 1n}, {a: 3n}],
 *      sumBy(x => x.a)
 *    ) // 9n
 * @dataLast
 * @category Array
 */
export function sumBy(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/pipe.js`, `src/prop.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/sumBy.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/sumBy.js` erased them.

```ts
type SumBy<
  T extends IterableContainer,
  U extends bigint | number,
> = T extends readonly []
  ? 0
  : T extends readonly [unknown, ...(readonly unknown[])]
    ? U
    : U | 0;
```
