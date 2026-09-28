# Implement chunk from remeda

`src/chunk.js` is the JavaScript build of `packages/remeda/src/chunk.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `chunk`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Split an array into groups the length of `size`. If `array` can't be split evenly, the final chunk will be the remaining elements.
 *
 * @param array - The array.
 * @param size - The length of the chunk.
 * @signature
 *    chunk(array, size)
 * @example
 *    chunk(['a', 'b', 'c', 'd'], 2) // => [['a', 'b'], ['c', 'd']]
 *    chunk(['a', 'b', 'c', 'd'], 3) // => [['a', 'b', 'c'], ['d']]
 * @dataFirst
 * @category Array
 */
export function chunk(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/chunk.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/chunk.js` erased them.

```ts
type MAX_LITERAL_SIZE = 350;

type Chunk<
  T extends IterableContainer,
  N extends number,
> = T extends readonly []
  ? []
  : IsNumericLiteral<N> extends true
    ? LessThan<N, 1> extends true
      ? never
      : LessThan<N, MAX_LITERAL_SIZE> extends true
        ? // The spread here is used as a form of "Simplify" for arrays; without
          // it our return type isn't useful.
          [...LiteralChunk<T, N>]
        : GenericChunk<T>
    : GenericChunk<T>;

type LiteralChunk<T extends IterableContainer, N extends number> =
  | ChunkRestElement<
      // Our result will always have the prefix tuple chunked the same way, so
      // we compute it once here and send it to the main logic below
      ChunkFixedTuple<TuplePrefix<T>, N>,
      TupleParts<T>["item"],
      TupleParts<T>["suffix"],
      N
    >
  // If both the prefix and suffix tuples are empty then our input is a simple
  // array of the form `Item[]`. This means it could also be empty, so we
  // need to add the empty output to our return type.
  | ([...TuplePrefix<T>, ...TupleParts<T>["suffix"]] extends readonly []
      ? []
      : never);

/**
 * This type **only** works if the input array `T` is a fixed tuple. For these
 * inputs the chunked output could be computed as literal finite tuples too.
 */
type ChunkFixedTuple<
  T,
  N extends number,
  // Important! Result is initialized with an empty array (and not `[[]]`)
  // because the result of `chunk` on an empty array is `[]` and not `[[]]`.
  Result = [],
> = T extends readonly [infer Head, ...infer Rest]
  ? // We continue consuming the input tuple recursively item by item.
    ChunkFixedTuple<
      Rest,
      N,
      Result extends [
        ...infer Previous extends unknown[][],
        infer Current extends unknown[],
      ]
        ? // We take a look at the last chunk in the result, this is the
          // "current" chunk where new items would be added, all chunks before
          // it are already full.
          Current["length"] extends N
          ? // The current chunk is full, create a new chunk and put Head in it.
            [...Previous, Current, [Head]]
          : // The current chunk is not full yet, so we add Head to it.
            [...Previous, [...Current, Head]]
        : // This would only happen on the first iteration, when result is
          // still empty. In this case we create the first chunk and put Head
          // in it.
          [[Head]]
    >
  : // We know T is a finite tuple, so the only case where we would reach this
    // is when T is empty, and in that case our results array contains the whole
    // input chunked by N.
    Result;

/**
 * Here lies the main complexity of building the chunk type. It takes the prefix
 * chunks, the rest param item type, and the suffix (not chunked!) and it
 * creates all possible combinations of adding items to the prefix and suffix
 * for all possible scenarios for how many items the rest param "represents".
 */
type ChunkRestElement<
  PrefixChunks,
  Item,
  Suffix extends unknown[],
  N extends number,
> =
  IsNever<Item> extends true
    ? // The rest param is never when there is no rest param, the whole array is
      // a finite tuple and is represented already by the prefix chunks. Suffix
      // is assumed to be empty in this case.
      PrefixChunks
    : PrefixChunks extends [
          ...infer PrefixFullChunks extends unknown[][],
          infer LastPrefixChunk extends unknown[],
        ]
      ? // When our prefix chunks are not empty it means we need to look at all
        // combinations of mixing the prefix, the suffix, and different counts
        // of the rest param until we cover all possible scenarios.
        | ValueOf<{
            // We want to iterate over all possible padding sizes we can add to
            // the last prefix chunk until we reach N
            // (`0..N-LastPrefixChunk.length`). We need to do this because
            // until the last prefix chunk is full, we need to consider the
            // suffix being part of it too...
            [
              Padding in IntRangeInclusive<
                0,
                Subtract<N, LastPrefixChunk["length"]>
              >
            ]: [
              ...PrefixFullChunks,
              ...ChunkFixedTuple<
                // Create a new array that would **not** contain a rest param
                // (so it's finite) made of the last prefix chunk, padding from
                // the rest param, and the suffix.
                [...LastPrefixChunk, ...NTuple<Item, Padding>, ...Suffix],
                N
              >,
            ];
          }>
        // Additionally, we need to consider the case where the last prefix
        // chunk **is** full, and follow it with an array of chunks of the rest
        // param (and only them), and then followed by all possible variations
        // of the suffix chunks.
        | [
            ...PrefixFullChunks,
            [
              // Fully padded last prefix chunk
              ...LastPrefixChunk,
              ...NTuple<Item, Subtract<N, LastPrefixChunk["length"]>>,
            ],
            ...NTuple<Item, N>[],
            ...SuffixChunk<Suffix, Item, N>,
          ]
      : // When our prefix chunks are empty we only need to handle the suffix
        [...NTuple<Item, N>[], ...SuffixChunk<Suffix, Item, N>];

/**
 * This type assumes it takes a finite tuple that represents the suffix of our
 * input array. It builds all possible combinations of adding items to the
 * **head** of the suffix in order to pad the suffix until the last chunk is
 * full.
 */
type SuffixChunk<
  T extends unknown[],
  Item,
  N extends number,
> = T extends readonly []
  ? // If we don't have a suffix we simply create a single chunk with all
    // possible non-empty sub-arrays of `Item` up to size `N`.
    [ValueOf<{ [K in IntRangeInclusive<1, N>]: NTuple<Item, K> }>]
  : ValueOf<{
      // When suffix isn't empty we pad the head of the suffix and compute it's
      // chunks for all possible padding sizes.
      [Padding in IntRange<0, N>]: ChunkFixedTuple<
        [...NTuple<Item, Padding>, ...T],
        N
      >;
    }>;

/**
 * This is the legacy type used when we don't know what N is. We can only adjust
 * our output based on if we know for sure that the array is empty or not.
 */
type GenericChunk<T extends IterableContainer> = T extends
  readonly [...unknown[], unknown] | readonly [unknown, ...unknown[]]
  ? NonEmptyArray<NonEmptyArray<T[number]>>
  : NonEmptyArray<T[number]>[];

type TuplePrefix<T extends IterableContainer> = [
  ...TupleParts<T>["required"],
  ...PartialArray<TupleParts<T>["optional"]>,
];
```
