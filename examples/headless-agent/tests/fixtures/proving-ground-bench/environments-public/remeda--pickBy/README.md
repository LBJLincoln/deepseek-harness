# Implement pickBy from remeda

`src/pickBy.js` is the JavaScript build of `packages/remeda/src/pickBy.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `pickBy`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Iterates over the entries of `data` and reconstructs the object using only
 * entries that `predicate` accepts. Symbol keys are not passed to the predicate
 * and would be filtered out from the output object.
 *
 * See `omitBy` for a complementary function which starts with a shallow copy of
 * the input object and removes the entries that the predicate rejects. Because
 * it is subtractive symbol keys would be copied over to the output object.
 * See also `entries`, `filter`, and `fromEntries` which could be used to build
 * your own version of `pickBy` if you need more control (though the resulting
 * type might be less precise).
 *
 * @param data - The target object.
 * @param predicate - A function that takes the value, key, and the data itself
 * and returns true if the entry should be part of the output object, or `false`
 * to remove it. If the function is a type-guard on the value the output type
 * would be narrowed accordingly.
 * @returns A shallow copy of the input object with the rejected entries
 * removed.
 * @signature pickBy(data, predicate)
 * @example
 *    pickBy({a: 1, b: 2, A: 3, B: 4}, (val, key) => key.toUpperCase() === key) // => {A: 3, B: 4}
 * @dataFirst
 * @category Object
 */
export function pickBy(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/constant.js`, `src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/pipe.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/pickBy.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/pickBy.js` erased them.

```ts
type EnumeratedPartial<T> = T extends unknown
  ? Simplify<
      IsBoundedRecord<T> extends true
        ? {
            // Object.entries returns keys as strings.
            -readonly [P in keyof T as ToString<P>]?: Required<T>[P];
          }
        : // For unbounded records (a simple Record with primitive `string` or
          // `number` keys) the return type here could technically be T; but for
          // cases where the record is unbounded but is more complex (like
          // `symbol` keys) we want to "reconstruct" the record from just its
          // enumerable components (which are the ones accessible via
          // `Object.entries`).
          Record<EnumerableStringKeyOf<T>, EnumerableStringKeyedValueOf<T>>
    >
  : never;

type EnumeratedPartialNarrowed<T, S> = T extends unknown
  ? Simplify<
      IsBoundedRecord<T> extends true
        ? ExactProps<T, S> & PartialProps<T, S>
        : // For unbounded records we need to "reconstruct" the record and
          // narrow the value types. Similar to the non-narrowed case, we need
          // to also ignore `symbol` keys and any values that are only relevant
          // to them.
          Record<
            EnumerableStringKeyOf<T>,
            Extract<EnumerableStringKeyedValueOf<T>, S>
          >
    >
  : never;

type ExactProps<T, S> = {
  // Object.entries returns keys as strings.
  -readonly [
    P in keyof T as ToString<IsExactProp<T, P, S> extends true ? P : never>
  ]: Extract<Required<T>[P], S>;
};

type PartialProps<T, S> = {
  // Object.entries returns keys as strings.
  -readonly [
    P in keyof T as ToString<IsPartialProp<T, P, S> extends true ? P : never>
  ]?: IsNever<Extract<T[P], S>> extends true
    ? // If the result of extracting S from T[P] is never but S still extends
      // it, it means that T[P] is too wide and S can't be extracted from it:
      // e.g. if T[P] is `number` S is `1` then `Extract<number, 1> === never`.
      // For these cases we can return S directly as the type as it's already
      // very narrowed compared to T[P].
      S extends T[P]
      ? S
      : never
    : Extract<T[P], S>;
};

type IsExactProp<T, P extends keyof T, S> =
  T[P] extends Extract<T[P], S> ? true : false;

type IsPartialProp<T, P extends keyof T, S> =
  IsExactProp<T, P, S> extends true
    ? false
    : IsNever<Extract<T[P], S>> extends true
      ? S extends T[P]
        ? // If the result of extracting S from T[P] is never but S still
          // extends it, it means that T[P] is too wide and S can't be
          // extracted from it: e.g. if T[P] is `number` S is `1` then
          // `Extract<number, 1> === never`, but `1` extends `number`. We need
          // to handle these cases when we extract the value too (see above).
          true
        : false
      : true;
```
