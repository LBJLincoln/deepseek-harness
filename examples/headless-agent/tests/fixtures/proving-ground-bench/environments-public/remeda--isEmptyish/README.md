# Implement isEmptyish from remeda

`src/isEmptyish.js` is the JavaScript build of `packages/remeda/src/isEmptyish.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `isEmptyish`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * A function that checks if the input is empty. Empty is defined as anything
 * exposing a numerical `length`, or `size` property that is equal to `0`. This
 * definition covers strings, arrays, Maps, Sets, plain objects, and custom
 * classes. Additionally, `null` and `undefined` are also considered empty.
 *
 * `number`, `bigint`, `boolean`, `symbol`, and `function` will always return
 * `false`. `RegExp`, `Date`, and weak collections will always return `true`.
 * Classes and Errors are treated as plain objects: if they expose any public
 * property they would be considered non-empty, unless they expose a numerical
 * `length` or `size` property, which defines their emptiness regardless of
 * other properties.
 *
 * This function has *limited* utility at the type level because **negating** it
 * does not yield a useful type in most cases because of TypeScript
 * limitations. Additionally, utilities which accept a narrower input type
 * provide better type-safety on their inputs. In most cases, you should use
 * one of the following functions instead:
 * * `isEmpty` - provides better type-safety on inputs by accepting a narrower set of cases.
 * * `hasAtLeast` - when the input is just an array/tuple.
 * * `isStrictEqual` - when you just need to check for a specific literal value.
 * * `isNullish` - when you just care about `null` and `undefined`.
 * * `isTruthy` - when you need to also filter `number` and `boolean`.
 *
 * @param data - The variable to check.
 * @signature
 *    isEmptyish(data)
 * @example
 *    isEmptyish(undefined); //=> true
 *    isEmptyish(null); //=> true
 *    isEmptyish(''); //=> true
 *    isEmptyish([]); //=> true
 *    isEmptyish({}); //=> true
 *    isEmptyish(new Map()); //=> true
 *    isEmptyish(new Set()); //=> true
 *    isEmptyish({ a: "hello", size: 0 }); //=> true
 *    isEmptyish(/abc/); //=> true
 *    isEmptyish(new Date()); //=> true
 *    isEmptyish(new WeakMap()); //=> true
 *
 *    isEmptyish('test'); //=> false
 *    isEmptyish([1, 2, 3]); //=> false
 *    isEmptyish({ a: "hello" }); //=> false
 *    isEmptyish({ length: 1 }); //=> false
 *    isEmptyish(0); //=> false
 *    isEmptyish(true); //=> false
 *    isEmptyish(() => {}); //=> false
 * @category Guard
 */
export function isEmptyish(data: unknown): boolean

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/isEmptyish.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/isEmptyish.js` erased them.

```ts
type Empty<T> = Tagged<T, typeof BRAND_EMPTYISH>;

type Emptyish<T> =
  // There are effectively 4 types that can be empty:
  | (T extends string ? "" : never)
  | (T extends object ? EmptyishObjectLike<T> : never)
  | (T extends null ? null : never)
  | (T extends undefined ? undefined : never);

type EmptyishObjectLike<T extends object> = T extends readonly unknown[]
  ? EmptyishArray<T>
  : T extends ReadonlyMap<infer Key, unknown>
    ? T extends Map<unknown, unknown>
      ? // Mutable maps should remain mutable so we can't narrow them down.
        Empty<T>
      : // But immutable maps could be rewritten to prevent any mutations.
        ReadonlyMap<Key, never>
    : T extends ReadonlySet<unknown>
      ? T extends Set<unknown>
        ? // Mutable sets should remain mutable so we can't narrow them down.
          Empty<T>
        : // But immutable sets could be rewritten to prevent any mutations.
          ReadonlySet<never>
      : EmptyishObject<T>;

type EmptyishArray<T extends readonly unknown[]> = T extends readonly []
  ? // By returning T we effectively narrow the "else" branch to `never`.
    T
  : TupleParts<T>["required"] extends readonly []
    ? TupleParts<T>["suffix"] extends readonly []
      ? T extends unknown[]
        ? // A mutable array should remain mutable so we can't narrow it down.
          Empty<T>
        : // But immutable arrays could be rewritten to prevent any mutations.
          readonly []
      : // An array with a required prefix or suffix would never be empty, we
        // can use that fact to narrow the "if" branch to `never`.
        never
    : never;

type EmptyishObject<T extends object> = T extends {
  length: infer Length extends number;
}
  ? T extends string
    ? // When a string is tagged/branded it also extends `object` and also has
      // a `length` prop so we need to prevent handling it because it's
      // irrelevant here!
      never
    : // Because of how the implementation works, we need to consider any object
      // with a `length` prop as potentially "empty".
      EmptyishArbitrary<T, Length>
  : T extends { size: infer Size extends number }
    ? // Because of how the implementation works, we need to consider any object
      // with a `size` prop as potentially "empty".
      EmptyishArbitrary<T, Size>
    : IsNever<ValueOf<T>> extends true
      ? // This handles empty objects; by returning T we effectively narrow the
        // "else" branch to `never`.
        T
      : HasRequiredKeys<OmitIndexSignature<T>> extends true
        ? // If the object has required keys it can never be empty, we can use
          // that fact to narrow the "if" branch to `never`.
          never
        : HasWritableKeys<T> extends true
          ? // A mutable object should remain mutable so we can't narrow it
            // down.
            Empty<T>
          : // But immutable objects could be rewritten to prevent any
            // mutations.
            { readonly [P in keyof T]: never };

type EmptyishArbitrary<T, N> =
  IsNumericLiteral<N> extends true
    ? [0] extends [N]
      ? [N] extends [0]
        ? // If the prop is a literal 0 the object is and always will be empty
          // so we can return it to narrow the "else" branch as `never`.
          T
        : // If it accepts 0, but might accept other values too we need to
          // consider the object mutable and not narrow it down.
          Empty<T>
      : // If the prop will never be 0 we can say it will never be empty and can
        // return `never` for the "if" branch.
        never
    : // If the prop isn't a literal value we don't know enough about the object
      // and should consider it mutable.
      Empty<T>;

type ShouldNotNarrow<T> = unknown extends T
  ? true
  : IsAny<T> extends true
    ? true
    : IsEqual<
          T,
          // eslint-disable-next-line @typescript-eslint/no-empty-object-type
          {}
        > extends true
      ? true
      : false;
```
