# Implement omit from remeda

`src/omit.js` is the JavaScript build of `packages/remeda/src/omit.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `omit`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Returns a partial copy of an object omitting the keys specified.
 *
 * @param keys - The property names.
 * @signature
 *    omit(keys)(obj);
 * @example
 *    pipe({ a: 1, b: 2, c: 3, d: 4 }, omit(['a', 'd'])) // => { b: 2, c: 3 }
 * @dataLast
 * @category Object
 */
export function omit(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/add.js`, `src/constant.js`, `src/evolve.js`, `src/hasAtLeast.js`, `src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/length.js`, `src/map.js`, `src/pipe.js`, `src/purry.js`, `src/reduce.js`, `src/set.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/omit.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/omit.js` erased them.

```ts
type OmitFromArray<T, Keys extends readonly PropertyKey[]> =
  // Distribute unions for both object types and key arrays.
  T extends unknown
    ? Keys extends unknown
      ? // The output is always writable because we always create a new object!
        SimplifiedWritable<
          IsNever<Extract<Keys[number], keyof T>> extends true
            ? // When none of the keys belong to T we can short-circuit and
              // simply return T as-is because `omit` would do nothing.
              T
            : IsBoundedRecord<T> extends true
              ? OmitBounded<T, Keys>
              : OmitUnbounded<T, Keys>
        >
      : never
    : never;

type OmitBounded<T, Keys extends readonly PropertyKey[]> =
  // We build our output by first considering any key present in the keys array
  // as being omitted. This object would contain all keys that are unaffected at
  // all by this omit operation.
  FixEmpty<Omit<T, Keys[number]>> &
    // But we might be missing keys that are optional in the keys tuple (and
    // thus might not be removed). Because these keys are optional, their props
    // in the output also need to be optional.
    Partial<
      Pick<
        T,
        Exclude<
          // Find all keys that can either be omitted or not, these are all keys
          // in unions in the required parts of the keys tuple (the prefix and
          // the suffix), as well as all keys in the optional parts and the rest
          // item.
          | PartitionByUnion<TupleParts<Keys>["required"]>["union"]
          | TupleParts<Keys>["optional"][number]
          | TupleParts<Keys>["item"]
          | PartitionByUnion<TupleParts<Keys>["suffix"]>["union"],
          // We then need to remove from these any items which *also* are
          // ensured to always exist in the keys tuple, these are the elements
          // of the required parts of the tuple which are singular (not unions).
          | PartitionByUnion<TupleParts<Keys>["required"]>["singular"]
          | PartitionByUnion<TupleParts<Keys>["suffix"]>["singular"]
        >
      >
    >;

/**
 * The built-in `Omit` type doesn't handle unbounded records correctly! When
 * omitting an unbounded key the result should be untouched as we can't tell
 * what got removed, and can't represent an object that had "something" removed
 * from it, but instead it returns `{}`(?!) The same thing applies when a key
 * is only optionally omitted for the same reasons. This is why we don't use
 * `Omit` at all for the unbounded case.
 *
 * @see https://www.typescriptlang.org/play/?#code/C4TwDgpgBAqgdgIwPYFc4BMLqgXigeQFsBLYAHgCUIBjJAJ3TIGdg7i4BzAGigCIALCABshSXgD4eLNp3EBuAFAB6JVDUA9APxA
 */
type OmitUnbounded<T, Keys extends readonly PropertyKey[]> = T &
  // Any key we know for sure is being omitted needs to become "impossible" to
  // access; for an unbounded record this means merging it with a bounded record
  // with `never` value for these keys.
  Record<
    Bounded<
      | PartitionByUnion<TupleParts<Keys>["required"]>["singular"]
      | PartitionByUnion<TupleParts<Keys>["suffix"]>["singular"]
    >,
    never
  >;

/**
 * When `Omit` omits **all** keys from a bounded record it results in `{}` which
 * doesn't match what we'd expect to be returned in terms of a useful type as
 * the output of `Omit`.
 */
type FixEmpty<T> = IsNever<keyof T> extends true ? EmptyObject : T;

/**
 * Filter a union of types, leaving only those that are bounded. e.g.,
 * `Bounded<"a" | number>` results in `"a"`.
 */
type Bounded<T> = T extends unknown
  ? IsBounded<T> extends true
    ? T
    : never
  : never;
```
