# Implement swapIndices from remeda

`src/swapIndices.js` is the JavaScript build of `packages/remeda/src/swapIndices.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `swapIndices`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Swaps the positions of two elements in an array or string at the provided indices.
 *
 * Negative indices are supported and would be treated as an offset from the end of the array. The resulting type thought would be less strict than when using positive indices.
 *
 * If either index is out of bounds the result would be a shallow copy of the input, as-is.
 *
 * Related operations:
 * - `splice` - for more general positional edits (remove a slice, insert at an index).
 *
 * @param data - The item to be manipulated. This can be an array, or a string.
 * @param index1 - The first index.
 * @param index2 - The second index.
 * @returns Returns the manipulated array or string.
 * @signature
 *   swapIndices(data, index1, index2)
 * @example
 *   swapIndices(['a', 'b', 'c'], 0, 1) // => ['b', 'a', 'c']
 *   swapIndices(['a', 'b', 'c'], 1, -1) // => ['a', 'c', 'b']
 *   swapIndices('abc', 0, 1) // => 'bac'
 * @dataFirst
 * @category Array
 */
export function swapIndices(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/swapIndices.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/swapIndices.js` erased them.

```ts
type Difference<A extends number, B extends number> =
  TupleOfLength<A> extends [...infer U, ...TupleOfLength<B>]
    ? U["length"]
    : never;

type isLessThan<A extends number, B extends number> =
  IsEqual<A, B> extends true
    ? false
    : 0 extends A
      ? true
      : 0 extends B
        ? false
        : isLessThan<Difference<A, 1>, Difference<B, 1>>;

type TupleOfLength<
  L extends number,
  T extends IterableContainer = [],
> = T["length"] extends L ? T : TupleOfLength<L, [...T, unknown]>;

type IsNonNegative<T extends number> = number extends T
  ? false
  : `${T}` extends `-${string}`
    ? false
    : true;

type CharactersTuple<T extends string> = string extends T
  ? string[]
  : T extends `${infer C}${infer R}`
    ? [C, ...CharactersTuple<R>]
    : [];

type SwapArrayInternal<
  T extends IterableContainer,
  Index1 extends number,
  Index2 extends number,
  Position extends readonly unknown[] = [],
  Original extends IterableContainer = T,
> = T extends readonly [infer AtPosition, ...infer Rest]
  ? [
      Position["length"] extends Index1
        ? Original[Index2]
        : Position["length"] extends Index2
          ? Original[Index1]
          : AtPosition,
      ...SwapArrayInternal<
        Rest,
        Index1,
        Index2,
        [unknown, ...Position],
        Original
      >,
    ]
  : T;

type SwapString<T extends string, K1 extends number, K2 extends number> = Join<
  SwapArray<CharactersTuple<T>, K1, K2>,
  ""
>;

type SwapArray<
  T extends IterableContainer,
  K1 extends number,
  K2 extends number,
> =
  IsNonNegative<K1> extends true
    ? IsNonNegative<K2> extends true
      ? isLessThan<K1, T["length"]> extends true
        ? isLessThan<K2, T["length"]> extends true
          ? SwapArrayInternal<T, K1, K2>
          : // If the indices are not within the input arrays range the result
            // would be trivially the same as the input array.
            T
        : T
      : // TODO [>3]: Because of limitations on the typescript version used in Remeda we can't build a proper Absolute number type so we can't implement proper typing for negative indices and have to opt for a less-strict type instead. Check out the history for the PR that introduced this TODO to see how it could be implemented.
        T[number][]
    : T[number][];

type SwappedIndices<
  T extends IterableContainer | string,
  K1 extends number,
  K2 extends number,
> = T extends string
  ? SwapString<T, K1, K2>
  : T extends IterableContainer
    ? SwapArray<T, K1, K2>
    : never;
```
