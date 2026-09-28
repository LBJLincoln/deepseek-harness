# Implement pathOr from remeda

`src/pathOr.js` is the JavaScript build of `packages/remeda/src/pathOr.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `pathOr`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Gets the value at `path` of `object`. If the resolved value is `null` or `undefined`, the `defaultValue` is returned in its place.
 *
 * **DEPRECATED**: Use `defaultTo(prop(object, ...path), defaultValue)`
 * instead!
 *
 * @param object - The target object.
 * @param path - The path of the property to get.
 * @param defaultValue - The default value.
 * @signature pathOr(object, array, defaultValue)
 * @example
 *    pathOr({x: 10}, ['y'], 2) // 2
 *    pathOr({y: 10}, ['y'], 2) // 10
 * @dataFirst
 * @category Object
 * @deprecated Use `defaultTo(prop(object, ...path), defaultValue)` instead.
 */
export function pathOr(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/pipe.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/pathOr.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/pathOr.js` erased them.

```ts
/**
 * Given a union of indexable types `T`, we derive an indexable type
 * containing all of the keys of each variant of `T`. If a key is
 * present in multiple variants of `T`, then the corresponding type in
 * `Pathable<T>` will be the intersection of all types for that key.
 *
 * @example
 *    type T1 = Pathable<{a: number} | {a: string; b: boolean}>
 *    // {a: number | string; b: boolean}
 *
 *    type T2 = Pathable<{a?: {b: string}}
 *    // {a: {b: string} | undefined}
 *
 *    type T3 = Pathable<{a: string} | number>
 *    // {a: string}
 *
 *    type T4 = Pathable<{a: number} | {a: string} | {b: boolean}>
 *    // {a: number | string; b: boolean}
 *
 * This type lets us answer the questions:
 * - Given some object of type `T`, what keys might this object have?
 * - If this object did happen to have a particular key, what values
 *   might that key have?
 */
type Pathable<T> = { [K in AllKeys<T>]: TypesForKey<T, K> };

type AllKeys<T> = T extends infer I ? keyof I : never;

type TypesForKey<T, K extends PropertyKey> = T extends infer I
  ? K extends keyof I
    ? I[K]
    : never
  : never;

type StrictlyRequired<T> = { [K in keyof T]-?: NonNullable<T[K]> };

/**
 * Given some `A` which is a key of at least one variant of `T`, derive
 * `T[A]` for the cases where `A` is present in `T`, and `T[A]` is not
 * null or undefined.
 */
type PathValue1<T, A extends keyof Pathable<T>> = StrictlyRequired<
  Pathable<T>
>[A];

/** All possible options after successfully reaching `T[A]`. */
type Pathable1<T, A extends keyof Pathable<T>> = Pathable<PathValue1<T, A>>;

/** As `PathValue1`, but for `T[A][B]`. */
type PathValue2<
  T,
  A extends keyof Pathable<T>,
  B extends keyof Pathable1<T, A>,
> = StrictlyRequired<Pathable1<T, A>>[B];

/** As `Pathable1`, but for `T[A][B]`. */
type Pathable2<
  T,
  A extends keyof Pathable<T>,
  B extends keyof Pathable1<T, A>,
> = Pathable<PathValue2<T, A, B>>;

/** As `PathValue1`, but for `T[A][B][C]`. */
type PathValue3<
  T,
  A extends keyof Pathable<T>,
  B extends keyof Pathable1<T, A>,
  C extends keyof Pathable2<T, A, B>,
> = StrictlyRequired<Pathable2<T, A, B>>[C];
```
