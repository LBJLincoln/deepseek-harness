# Implement zipWith from remeda

`src/zipWith.js` is the JavaScript build of `packages/remeda/src/zipWith.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `zipWith`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates a new list from two supplied lists by calling the supplied function
 * with the same-positioned element from each list.
 *
 * @param fn - The function applied to each position of the list.
 * @signature
 *   zipWith(fn)(first, second)
 * @example
 *   zipWith((a: string, b: string) => a + b)(['1', '2', '3'], ['a', 'b', 'c']) // => ['1a', '2b', '3c']
 * @category Array
 */
export function zipWith(
  arg0: IterableContainer | ZippingFunction,
  arg1?: IterableContainer | LazyZippingFunction | ZippingFunction,
  arg2?: ZippingFunction,
): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/pipe.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/zipWith.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/zipWith.js` erased them.

```ts
type ZippingFunction<
  T1 extends IterableContainer = IterableContainer,
  T2 extends IterableContainer = IterableContainer,
  Value = unknown,
> = (
  first: T1[number],
  second: T2[number],
  index: number,
  data: readonly [first: T1, second: T2],
) => Value;

type LazyZippingFunction<
  T1 extends IterableContainer = IterableContainer,
  T2 extends IterableContainer = IterableContainer,
  Value = unknown,
> = (
  first: T1[number],
  second: T2[number],
  index: number,
  data: readonly [first: Readonly<NonEmptyPrefix<T1>>, second: T2],
) => Value;
```
