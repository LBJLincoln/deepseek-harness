# Implement hasSubObject from remeda

`src/hasSubObject.js` is the JavaScript build of `packages/remeda/src/hasSubObject.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `hasSubObject`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Checks if `subObject` is a sub-object of `object`, which means for every
 * property and value in `subObject`, there's the same property in `object`
 * with an equal value. Equality is checked with `isDeepEqual`.
 *
 * @param data - The object to test.
 * @param subObject - The sub-object to test against.
 * @signature
 *    hasSubObject(data, subObject)
 * @example
 *    hasSubObject({ a: 1, b: 2, c: 3 }, { a: 1, c: 3 }) //=> true
 *    hasSubObject({ a: 1, b: 2, c: 3 }, { b: 4 }) //=> false
 *    hasSubObject({ a: 1, b: 2, c: 3 }, {}) //=> true
 * @dataFirst
 * @category Guard
 */
export function hasSubObject(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/isDeepEqual.js`, `src/pipe.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/hasSubObject.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/hasSubObject.js` erased them.

```ts
type HasSubObjectGuard<T, S> = Simplify<
  Tagged<S & T, typeof BRAND_HAS_SUB_OBJECT>
>;

type HasSubObjectObjectValue<A, B> = Partial<{
  [Key in keyof A & keyof B]: IsNever<A[Key] & B[Key]> extends true
    ? B[Key]
    : A[Key] | B[Key] extends object
      ? HasSubObjectObjectValue<A[Key], B[Key]>
      : A[Key] & B[Key] extends object
        ? B[Key]
        : A[Key];
}> & {
  [
    Key in Exclude<keyof A, keyof B> | Exclude<keyof B, keyof A>
  ]: Key extends keyof B ? B[Key] : never;
};

type HasSubObjectData<
  Data,
  SubObject,
  RData = Required<Data>,
  RSubObject = Required<SubObject>,
> = Partial<{
  [Key in keyof RData & keyof RSubObject]: IsNever<
    RData[Key] & RSubObject[Key]
  > extends true
    ? RSubObject[Key]
    : RData[Key] | RSubObject[Key] extends object
      ? HasSubObjectObjectValue<RData[Key], RSubObject[Key]>
      : RData[Key] & RSubObject[Key] extends object
        ? RSubObject[Key]
        : RData[Key];
}> & {
  [Key in Exclude<keyof SubObject, keyof Data>]: SubObject[Key];
};

type HasSubObjectSubObject<
  SubObject,
  Data,
  RSubObject = Required<SubObject>,
  RData = Required<Data>,
> = Partial<{
  [Key in keyof RData & keyof RSubObject]: IsNever<
    RData[Key] & RSubObject[Key]
  > extends true
    ? RData[Key]
    : RData[Key] | RSubObject[Key] extends object
      ? HasSubObjectObjectValue<RSubObject[Key], RData[Key]>
      : RData[Key] & RSubObject[Key] extends object
        ? RData[Key]
        : RSubObject[Key];
}> &
  Record<Exclude<keyof SubObject, keyof Data>, never>;
```
