# Implement prop from remeda

`src/prop.js` is the JavaScript build of `packages/remeda/src/prop.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `prop`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Gets the value of the given property from an object. Nested properties can
 * be accessed by providing a variadic array of keys that define the path from
 * the root to the desired property. Arrays can be accessed by using numeric
 * keys. Unions, optional properties, and index signatures are handled
 * gracefully by returning `undefined` early for any non-existing property on
 * the path. Paths are validated against the object type to provide stronger
 * type safety, better compile-time errors, and to enable autocompletion in
 * IDEs.
 *
 * To check whether a key exists on the object, use `hasProp`.
 *
 * @param data - The object or array to access.
 * @param key - The key(s) for the property to extract.
 * @signature
 *   prop(data, ...keys);
 * @example
 *   prop({ foo: { bar: 'baz' } }, 'foo'); //=> { bar: 'baz' }
 *   prop({ foo: { bar: 'baz' } }, 'foo', 'bar'); //=> 'baz'
 *   prop(["cat", "dog"], 1); //=> 'dog'
 * @dataFirst
 * @category Object
 */
export function prop(
  maybeData: NonPropertyKey | PropertyKey,
  ...args: readonly PropertyKey[]
): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/add.js`, `src/constant.js`, `src/countBy.js`, `src/filter.js`, `src/flat.js`, `src/groupBy.js`, `src/identity.js`, `src/indexBy.js`, `src/internal/lazyDataLastImpl.js`, `src/internal/purryFromLazy.js`, `src/internal/purryOrderRules.js`, `src/internal/utilityEvaluators.js`, `src/isStrictEqual.js`, `src/isString.js`, `src/map.js`, `src/meanBy.js`, `src/pipe.js`, `src/pullObject.js`, `src/purry.js`, `src/sortBy.js`, `src/sumBy.js`, `src/take.js`, `src/toLowerCase.js`, `src/when.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/prop.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/prop.js` erased them.

```ts
type KeysDeep<T, Path extends readonly unknown[]> = KeysOfUnion<
  PropDeep<T, Path>
>;

type PropDeep<T, Path extends readonly unknown[]> = Path extends readonly [
  infer Key,
  ...infer Rest,
]
  ? PropDeep<Prop<T, Key>, Rest>
  : // Keys is a fixed tuple so we know we reach here only when we've reached
    // the output object.
    T;

type Prop<T, Key> =
  // Distribute the union to support unions of keys.
  T extends unknown
    ? // In a distributed union some of the union members might not be keys of a
      // specific object within a union of objects, those cases don't contribute
      // to the output type.
      Key extends keyof T
      ? T extends readonly unknown[]
        ? ArrayAt<T, Key>
        : | T[Key]
          // Keys that are only matched by an index signature (and not declared
          // explicitly) are not guaranteed to exist and need to be widened.
          | (Key extends keyof OmitIndexSignature<T> ? never : undefined)
      : undefined
    : never;

type NonPropertyKey = object | null | undefined;
```
