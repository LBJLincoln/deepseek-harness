# Implement drop from remeda

`src/drop.js` is the JavaScript build of `packages/remeda/src/drop.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `drop`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Removes first `n` elements from the `array`.
 *
 * Related operations:
 * - `dropLast` - same, but from the end of the array.
 * - `splice` - to remove or insert at an arbitrary index.
 * - `take` - to keep the first `n` instead.
 *
 * @param array - The target array.
 * @param n - The number of elements to skip.
 * @signature
 *    drop(array, n)
 * @example
 *    drop([1, 2, 3, 4, 5], 2) // => [3, 4, 5]
 * @dataFirst
 * @lazy
 * @category Array
 */
export function drop(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/map.js`, `src/pipe.js`, `src/purry.js`, `src/take.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/drop.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/drop.js` erased them.

```ts
type Drop<T extends IterableContainer, N extends number> =
  IsNegative<N> extends true
    ? // Negative numbers result in nothing being dropped, we return a shallow
      // clone of the array.
      Writable<T>
    : IsInteger<N> extends true
      ? ClampedIntegerSubtract<
          N,
          TupleParts<T>["required"]["length"]
        > extends infer RemainingPrefix extends number
        ? RemainingPrefix extends 0
          ? // The drop will occur within the required part of the tuple, we
            // simply remove those elements from it and reconstruct the rest of
            // the tuple.
            [
              ...DropFixedTuple<TupleParts<T>["required"], N>,
              ...PartialArray<TupleParts<T>["optional"]>,
              ...CoercedArray<TupleParts<T>["item"]>,
              ...TupleParts<T>["suffix"],
            ]
          : ClampedIntegerSubtract<
                RemainingPrefix,
                TupleParts<T>["optional"]["length"]
              > extends infer RemainingOptional extends number
            ? RemainingOptional extends 0
              ? // The drop will occur within the optional part of the tuple, we
                // completely remove the required part, remove enough elements
                // from the optional part, and reconstruct the rest of the
                // tuple.
                [
                  ...PartialArray<
                    DropFixedTuple<TupleParts<T>["optional"], RemainingPrefix>
                  >,
                  ...CoercedArray<TupleParts<T>["item"]>,
                  ...TupleParts<T>["suffix"],
                ]
              : // The drop will occur within the rest element or the suffix.
                // Because the suffix can contain any number of elements this
                // case adds more complexity as we need to consider all possible
                // (relevant) lengths. We start by considering the case where
                // there are enough elements within the rest param; this means
                // we still maintain the rest element as it could contain even
                // more elements, and we add the suffix untouched.
                | [
                    ...CoercedArray<TupleParts<T>["item"]>,
                    ...TupleParts<T>["suffix"],
                  ]
                // Additionally, we need to consider the case where the rest
                // element has up to the same number of elements as the suffix;
                // this will result in removing the rest element entirely, and
                // dropping elements from the suffix. We do this for all
                // possible values from 0 to N where N is the remaining value
                // after we handled the prefix. We can exclude the 0 case
                // because it is contained in the previous case.
                | Exclude<
                    DropFixedTuple<
                      TupleParts<T>["suffix"],
                      RemainingOptional,
                      true /* IncludePrefixes */
                    >,
                    TupleParts<T>["suffix"]
                  >
            : never
        : never
      : // We can't compute accurate types for non-integer numbers so we
        // fallback to the "legacy" typing where we convert our output to a
        // simple array. This is also the case when N is not a literal value
        // (e.g. it is `number`).
        // TODO: We can improve this type by returning a union of all possible dropped shapes (e.g. the equivalent of Drop<T, 1> | Drop<T, 2> | Drop<T, 3> | ...).
        T[number][];

type DropFixedTuple<
  T,
  N,
  // This flag controls if we want a union of all possible prefixes, or just the
  // final tuple with all N items dropped.
  IncludePrefixes = false,
  Dropped extends unknown[] = [],
> = Dropped["length"] extends N
  ? T
  : T extends readonly [unknown, ...infer Rest]
    ? | DropFixedTuple<Rest, N, IncludePrefixes, [...Dropped, unknown]>
      | (true extends IncludePrefixes ? T : never)
    : [];
```
