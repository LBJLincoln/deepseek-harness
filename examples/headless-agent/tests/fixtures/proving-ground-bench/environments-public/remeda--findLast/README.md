# Implement findLast from remeda

`src/findLast.js` is the JavaScript build of `packages/remeda/src/findLast.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `findLast`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Iterates the array in reverse order and returns the value of the first
 * element that satisfies the provided testing function. If no elements satisfy
 * the testing function, undefined is returned.
 *
 * Similar functions:
 * * `find` - If you need the first element that satisfies the provided testing function.
 * * `findLastIndex` - If you need the index of the found element in the array.
 * * `lastIndexOf` - If you need to find the index of a value.
 * * `includes` - If you need to find if a value exists in an array.
 * * `some` - If you need to find if any element satisfies the provided testing function.
 * * `filter` - If you need to find all elements that satisfy the provided testing function.
 *
 * @param data - The items to search in.
 * @param predicate - A function to execute for each element in the array. It
 * should return `true` to indicate a matching element has been found, and
 * `false` otherwise. A type-predicate can also be used to narrow the result.
 * @returns The last (highest-index) element in the array that satisfies the
 * provided testing function; undefined if no matching element is found.
 * @signature
 *    findLast(data, predicate)
 * @example
 *    findLast([1, 3, 4, 6], n => n % 2 === 1) // => 3
 * @dataFirst
 * @category Array
 */
export function findLast(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/pipe.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/findLast.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/findLast.js` erased them.

```ts
type FoundLast<T extends IterableContainer, Condition> =
  // We distribute the array type to support unions of arrays/tuples.
  T extends unknown
    ? FoundLastInFixedTuple<
        TupleParts<T>["suffix"],
        Condition,
        // When the suffix part doesn't have any item that would always match
        // we fall back to the optional parts of the tuple which might match.
        | Narrowed<TupleParts<T>["item"], Condition>
        | Narrowed<TupleParts<T>["optional"][number], Condition>
        // The required part is always present, but it precedes every other
        // part of the tuple, so any match in it is only the last one when the
        // parts after it have none; this makes it the fallback of them all.
        | FoundLastInFixedTuple<
            TupleParts<T>["required"],
            Condition,
            // When an item isn't found we need to return `undefined`, but
            // because it might still always exist in the required part we set
            // this return value as the fallback of the required part, this way
            // if the required part has a match the fallback isn't reached and
            // we don't add the `undefined`, and in any other case the fallback
            // would make sure we cover this case too.
            undefined
          >
      >
    : never;

type FoundLastInFixedTuple<T, Condition, Fallback> = T extends readonly [
  ...infer Rest,
  infer Last,
]
  ? Assignability<
      Last,
      Condition,
      {
        full: Last;

        // Because the match isn't full we need to also consider the rest of the
        // items too because in runtime we might skip the current item.
        partial:
          | Narrowed<Last, Condition>
          | FoundLastInFixedTuple<Rest, Condition, Fallback>;
        none: FoundLastInFixedTuple<Rest, Condition, Fallback>;
      }
    >
  : Fallback;

type FoundLastNonRefined<
  T extends IterableContainer,
  IsItemIncluded extends boolean,
> = boolean extends IsItemIncluded
  ? T[number] | undefined
  : IsItemIncluded extends true
    ? // `findLast(data, constant(true))` is equivalent to `last(data)`.
      LastArrayElement<T>
    : undefined;
```
