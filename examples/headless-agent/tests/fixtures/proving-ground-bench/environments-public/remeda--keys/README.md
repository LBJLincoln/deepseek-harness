# Implement keys from remeda

`src/keys.js` is the JavaScript build of `packages/remeda/src/keys.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `keys`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Returns a new array containing the keys of the array or object.
 *
 * @param data - Either an array or an object.
 * @signature
 *    keys(source)
 * @example
 *    keys(['x', 'y', 'z']); // => ['0', '1', '2']
 *    keys({ a: 'x', b: 'y', 5: 'z' }); // => ['a', 'b', '5']
 * @dataFirst
 * @category Object
 */
export function keys(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/keys.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/keys.js` erased them.

```ts
type Keys<T> = T extends IterableContainer ? ArrayKeys<T> : ObjectKeys<T>;

type ArrayKeys<T extends IterableContainer> = {
  -readonly [Index in keyof T]: Index extends number | string
    ? // Notice that we coalesce the values as strings, this is because in JS,
      // Object.keys always returns strings, even for arrays.
      ToString<IsIndexAfterSpread<T, Index> extends true ? number : Index>
    : // Index is typed as a symbol, this can't happen, but we need to guard
      // against it for typescript.
      never;
};

type IsIndexAfterSpread<
  T extends IterableContainer,
  Index extends number | string,
> =
  IsNever<IndicesAfterSpread<T>> extends true
    ? false
    : Index extends `${IndicesAfterSpread<T>}`
      ? true
      : false;

type IndicesAfterSpread<
  T extends readonly unknown[] | [],
  // We use this type to count how many items we consumed, it's just a pseudo-
  // element that is used for its length.
  Iterations extends readonly unknown[] = [],
> =
  IsNever<T[number]> extends true
    ? never
    : T extends readonly [unknown, ...infer Tail]
      ? IndicesAfterSpread<Tail, [unknown, ...Iterations]>
      : T extends readonly [...infer Head, unknown]
        ? | IndicesAfterSpread<Head, [unknown, ...Iterations]>
          | Iterations["length"]
        : Iterations["length"];

type ObjectKeys<T> =
  T extends Record<PropertyKey, never> ? [] : EnumerableStringKeyOf<T>[];
```
