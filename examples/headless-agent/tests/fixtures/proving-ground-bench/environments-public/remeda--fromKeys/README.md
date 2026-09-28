# Implement fromKeys from remeda

`src/fromKeys.js` is the JavaScript build of `packages/remeda/src/fromKeys.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `fromKeys`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates an object that maps each key in `data` to the result of `mapper` for
 * that key. Duplicate keys are overwritten, guaranteeing that `mapper` is run
 * for each item in `data`.
 *
 * There are several other functions that could be used to build an object from
 * an array:
 * * `indexBy` - Builds an object from an array of *values* and a mapper for keys.
 * * `pullObject` - Builds an object from an array of items with mappers for *both* keys and values.
 * * `fromEntries` - Builds an object from an array of key-value pairs.
 * Refer to the docs for more details.
 *
 * @param data - An array of keys of the output object. All items in the array
 * would be keys in the output array.
 * @param mapper - Takes a key and returns the value that would be associated
 * with that key.
 * @signature
 *   fromKeys(data, mapper);
 * @example
 *   fromKeys(["cat", "dog"], length()); // { cat: 3, dog: 3 } (typed as Partial<Record<"cat" | "dog", number>>)
 *   fromKeys([1, 2], add(1)); // { 1: 2, 2: 3 } (typed as Partial<Record<1 | 2, number>>)
 * @dataFirst
 * @category Object
 */
export function fromKeys(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/add.js`, `src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/pipe.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/fromKeys.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/fromKeys.js` erased them.

```ts
type ExactlyOneKey<T, V> = T extends PropertyKey ? Record<T, V> : never;

type FromKeys<T extends IterableContainer, V> = T extends readonly []
  ? // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- We want to return an empty object type here, but it's not trivial to build that in Typescript, other fixer suggestions like Record<PropertyKey, never> or Record<PropertyKey, unknown> both break our type tests so they don't do what we need here. Because the result is mutable this might be the correct type after all...
    {}
  : T extends readonly [infer Head, ...infer Rest]
    ? ExactlyOneKey<Head, V> & FromKeys<Rest, V>
    : T[number] extends PropertyKey
      ? BoundedPartial<Record<T[number], V>>
      : never;
```
