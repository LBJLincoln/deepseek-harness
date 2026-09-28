# Implement sample from remeda

`src/sample.js` is the JavaScript build of `packages/remeda/src/sample.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `sample`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Returns a random subset of size `sampleSize` from `array`.
 *
 * Maintains and infers most of the typing information that could be passed
 * along to the output. This means that when using tuples, the output will be
 * a tuple too, and when using literals, those literals would be preserved.
 *
 * The items in the result are kept in the same order as they are in the input.
 * If you need to get a shuffled response you can pipe the shuffle function
 * after this one.
 *
 * @param data - The array.
 * @param sampleSize - The number of elements to take.
 * @signature
 *    sample(array, sampleSize)
 * @example
 *    sample(["hello", "world"], 1); // => ["hello"] // typed string[]
 *    sample(["hello", "world"] as const, 1); // => ["world"] // typed ["hello" | "world"]
 * @dataFirst
 * @category Array
 */
export function sample(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/internal/purryFromLazy.js`, `src/internal/utilityEvaluators.js`, `src/pipe.js`, `src/purry.js`, `src/times.js`, `src/unique.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/sample.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/sample.js` erased them.

```ts
type Sampled<T extends IterableContainer, N extends number> = [N] extends [0]
  ? // Short-circuit on trivial inputs.
    []
  : [T["length"]] extends [0]
    ? []
    : IsNever<NonNegativeInteger<N>> extends true
      ? SampledPrimitive<T>
      : IsLongerThan<T, N> extends true
        ? SampledLiteral<T, N>
        : // If our tuple can never fulfil the sample size the only valid sample
          // is the whole input tuple. Because it's a shallow clone we also
          // strip any readonly-ness.
          Writable<T>;

/**
 * When N is not a non-negative integer **literal** we can't use it in our
 * reconstructing logic so we fallback to a simpler definition of the output of
 * sample, which is any sub-tuple shape of T, of **any length**.
 */
type SampledPrimitive<T extends IterableContainer> = [
  ...FixedSubTuples<TupleParts<T>["required"]>,
  // TODO: This might be accurate, but We currently have no tests that check optional elements!
  ...PartialArray<FixedSubTuples<TupleParts<T>["optional"]>>,
  ...CoercedArray<TupleParts<T>["item"]>,
  ...FixedSubTuples<TupleParts<T>["suffix"]>,
];

/**
 * Knowing N is a non-negative literal integer we can construct all sub-tuples
 * of T that are exactly N elements long.
 */
type SampledLiteral<T extends IterableContainer, N extends number> =
  | Combinations<
      [
        ...TupleParts<T>["required"],
        // TODO: This deliberately ignores optional elements which we don't have tests for either. In order to handle optional elements we can treat the "optional" tuple-part as more required elements.
        // We add N elements of the `item` type to the tuple so that we
        // consider any combination possible of elements of the prefix items,
        // any amount of rest items, and suffix items.
        ...(IsNever<TupleParts<T>["item"]> extends true
          ? []
          : NTuple<TupleParts<T>["item"], N>),
        ...TupleParts<T>["suffix"],
      ],
      N
    >
  // In addition to all sub-tuples of length N, we also need to consider all
  // tuples where the input is shorter than N. This will contribute exactly
  // one sub-tuple at each length from the minimum length of T and up to N-1.
  | SubSampled<
      TupleParts<T>["required"],
      // TODO: This deliberately ignores optional elements which we don't have tests for either. In order to handle optional elements we can treat the "optional" tuple-part as more required elements.
      TupleParts<T>["item"],
      TupleParts<T>["suffix"],
      N
    >;

type SubSampled<
  Prefix extends readonly unknown[],
  Item,
  Suffix extends readonly unknown[],
  N extends number,
> =
  IsLongerThan<[...Prefix, ...Suffix], N> extends true
    ? // We need to prevent overflows in case Prefix and Suffix are already long
      // enough
      never
    : [...Prefix, ...Suffix]["length"] extends N
      ? never
      : [...Prefix, ...Suffix] | SubSampled<[...Prefix, Item], Item, Suffix, N>;

type IsLongerThan<T extends readonly unknown[], N extends number> =
  // Checking for `undefined` is a neat trick to avoid needing to compare
  // integer literals because if N overflows the tuple then the type for that
  // element will be `undefined`. This only works for fixed tuples!
  [T[N]] extends [undefined] ? false : true;

type FixedSubTuples<T> = T extends readonly [infer Head, ...infer Rest]
  ? // For each element we either take it or skip it, and recurse over the rest.
    FixedSubTuples<Rest> | [Head, ...FixedSubTuples<Rest>]
  : [];

/**
 * Compute all combinations (sub-tuples) of T of exactly length N.
 */
type Combinations<
  T extends IterableContainer,
  N extends number,
  // Used an an incrementor that keeps track of the depth of the recursion.
  Counter extends readonly unknown[] = [],
> =
  // Distribute over N so the result is the union for all values, otherwise we
  // will only compute combinations for the smallest literal in the union.
  N extends unknown
    ? Counter["length"] extends N
      ? []
      : T extends readonly [infer Head, ...infer Rest]
        ? // For each element we either take it or skip it, and recurse over the
          // rest.
          | [Head, ...Combinations<Rest, N, [unknown, ...Counter]>]
          | Combinations<Rest, N, Counter>
        : never
    : never;
```
