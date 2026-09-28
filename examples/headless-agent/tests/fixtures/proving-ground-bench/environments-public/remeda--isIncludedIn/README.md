# Implement isIncludedIn from remeda

`src/isIncludedIn.js` is the JavaScript build of `packages/remeda/src/isIncludedIn.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `isIncludedIn`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Checks if the item is included in the container. This is a wrapper around
 * `Array.prototype.includes` and `Set.prototype.has` and thus relies on the
 * same equality checks that those functions do (which is reference equality,
 * e.g. `===`). In some cases the input's type is also narrowed to the
 * container's item types.
 *
 * Notice that unlike most functions, this function takes a generic item as it's
 * data and **an array** as it's parameter.
 *
 * @param data - The item that is checked.
 * @param container - The items that are checked against.
 * @returns `true` if the item is in the container, or `false` otherwise. In
 * cases the type of `data` is also narrowed down.
 * @signature
 *   isIncludedIn(data, container);
 * @example
 *   isIncludedIn(2, [1, 2, 3]); // => true
 *   isIncludedIn(4, [1, 2, 3]); // => false
 *
 *   const data = "cat" as "cat" | "dog" | "mouse";
 *   isIncludedIn(data, ["cat", "dog"] as const); // true (typed "cat" | "dog");
 * @dataFirst
 * @category Guard
 */
export function isIncludedIn(
  dataOrContainer: unknown,
  container?: readonly unknown[],
): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/filter.js`, `src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/isNot.js`, `src/map.js`, `src/pipe.js`, `src/purry.js`, `src/take.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/isIncludedIn.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/isIncludedIn.js` erased them.

```ts
/**
 * A "constant" tuple is a type that has a single runtime value that can fulfil
 * it. This means that it doesn't have any variadic/rest/spread/array parts, and
 * that all it's values are singular (non-union) literals.
 *
 * We use this type to allow narrowing when checking against a set of values
 * defined as a const.
 *
 * @example
 *   type T1 = IsConstantTuple<["cat", "dog", 3, true]>; // => true;
 *   type T2 = IsConstantTuple<["cat" | "dog"]>; // false;
 *   type T2 = IsConstantTuple<["cat", ..."cat"[]]>; // false;
 */
type IsConstantTuple<T extends IterableContainer> = T extends readonly []
  ? true
  : T extends readonly [infer Head, ...infer Rest]
    ? IsUnion<Head> extends true
      ? false
      : IsConstantTuple<Rest>
    : false;

/**
 * There is no way to tell Typescript to only narrow the "accepted" side of a
 * type-predicate and so in many cases the negated side is also affected, this
 * results in over-narrowing in many cases, breaking typing. For this reason we
 * only want to use the type-predicate variant of `isIncludedIn` when we can
 * assume the result represents the expected types (closely enough). This is not
 * and ideal solution and we will still generate wrong types in some cases (see
 * tests), but it reduces the surface of this problem significantly, while still
 * keeping the utility of `isIncludedIn` for the common cases.
 *
 * TL;DR - The types are narrowable when: T is literal and S is a pure tuple, or
 * when T isn't a literal, but S is.
 *
 * @example
 *   const data = 1 as 1 | 2 | 3;
 *   const container = [] as (1 | 2)[];
 *   if (isIncludedIn(data, container)) {
 *     ... it makes sense to narrow data to `1 | 2` as the value `3` is not part
 *     ... of the typing of container, so will never result in being true.
 *   } else {
 *     ... but it doesn't make sense to narrow the value to 3 here, because 1
 *     ... and 2 are still valid values for data, when container doesn't include
 *     ... them **at runtime**.
 *     ... Typescript narrows the _rejected_ branch based on how it narrowed the
 *     ... _accepted_ clause, and we can't control that; because our input type
 *     ... is `1 | 2 | 3` and the accepted side is `1 | 2`, the rejected side is
 *     ... typed `Exclude<1 | 2 | 3, 1 | 2>`, which is `3`.
 *   }
 * }
 */
type IsNarrowable<T, S extends IterableContainer<T>> =
  IsLiteral<T> extends true
    ? // When T is literal (i.g. it isn't a primitive type like `string` or
      // `number`) then the criteria for narrowing is that the container is a
      // "pure" tuple because we *assume* that S represents a constant set of
      // values, and that it's typing also represents it's runtime content 1-
      // for-1. If S isn't a pure tuple it means we can't tell from the typing
      // which of it's values are actually present in runtime so can't use them
      // to narrow correctly.
      IsConstantTuple<S>
    : // When T isn't a literal type but the items in S are we can narrow the
      // type because it won't affect the negated side (`Exclude<number, 3>`
      // is still `number`).
      IsLiteral<S[number]>;
```
