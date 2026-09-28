# Implement mapKeys from remeda

`src/mapKeys.js` is the JavaScript build of `packages/remeda/src/mapKeys.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `mapKeys`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Maps keys of `object` and keeps the same values.
 *
 * @param data - The object to map.
 * @param keyMapper - The mapping function.
 * @signature
 *    mapKeys(object, fn)
 * @example
 *    mapKeys({a: 1, b: 2}, (key, value) => key + value) // => { a1: 1, b2: 2 }
 * @dataFirst
 * @category Object
 */
export function mapKeys(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/constant.js`, `src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/pipe.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/mapKeys.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/mapKeys.js` erased them.

```ts
type MappedKeys<T, Key extends PropertyKey> = MaybePartial<
  T,
  Key,
  // We re-key `T` using `Key`, but because we can't infer at the type level
  // how the mapper would map each specific input key we assign all props the
  // same value, made of all possible values of `T`.
  Record<Key, EnumerableStringKeyedValueOf<T>>
>;

/**
 * This type is very similar to `BoundedPartial` simplified to the case where
 * we reconstruct the Record using a known `Key` type.
 *
 * @see BoundedPartial
 */
type MaybePartial<T, Key extends PropertyKey, Output> =
  IsBounded<Key> extends true
    ? // When keys are bounded we need to consider what assurances we can make
      // about the presence of keys in the output; mainly if there is more than
      // one possible result from the mapper (so we can't know what it would
      // return for a specific input, at the type level), or if object itself
      // might be empty and thus also the output object.
      IsUnion<Key> extends true
      ? Partial<Output>
      : CouldBeEmpty<T> extends true
        ? Partial<Output>
        : Output
    : // If keys are not bounded TypeScript treats the Record as implicitly
      // Partial so we don't need to do that here.
      Output;

/**
 * Types that are extendable by `{}` are also satisfied by an empty object and
 * thus _could be empty_.
 */
type CouldBeEmpty<T> = {} extends T ? true : false;
```
