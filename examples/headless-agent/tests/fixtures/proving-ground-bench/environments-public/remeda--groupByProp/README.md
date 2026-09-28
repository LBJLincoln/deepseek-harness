# Implement groupByProp from remeda

`src/groupByProp.js` is the JavaScript build of `packages/remeda/src/groupByProp.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `groupByProp`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Groups the elements of an array of objects based on the values of a
 * specified property of those objects. The result would contain a property for
 * each unique value of the specific property, with it's value being the input
 * array filtered to only items that have that property set to that value.
 * For any object where the property is missing, or if it's value is
 * `undefined` the item would be filtered out.
 *
 * The grouping property is enforced at the type level to exist in at least one
 * item and to never have a value that cannot be used as an object key (e.g. it
 * must be `PropertyKey | undefined`).
 *
 * The resulting arrays are filtered with the prop and it's value as a
 * type-guard, effectively narrowing the items in each output arrays. This
 * means that when the grouping property is the discriminator of a
 * discriminated union type each output array would contain just the subtype for
 * that value.
 *
 * If you need more control over the grouping you should use `groupBy` instead.
 *
 * @param data - The items to group.
 * @param prop - The property name to group by.
 * @signature
 *    groupByProp(data, prop)
 * @example
 *    const result = groupByProp(
 *      //  ^? { cat: [{ a: 'cat' }], dog: [{ a: 'dog' }] }
 *      [{ a: 'cat' }, { a: 'dog' }] as const,
 *      'a',
 *    );
 * @dataFirst
 * @category Array
 */
export function groupByProp(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/pipe.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/groupByProp.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/groupByProp.js` erased them.

```ts
type GroupByProp<T extends IterableContainer, Prop extends GroupableProps<T>> =
  // Distribute unions.
  T extends unknown
    ? FixEmptyObject<EnsureValuesAreNonEmpty<GroupByPropRaw<T, Prop>>>
    : never;

type GroupByPropRaw<
  T extends IterableContainer,
  Prop extends GroupableProps<T>,
> = {
  [Value in AllPropValues<T, Prop>]: FilteredArray<T, Record<Prop, Value>>;
};

type GroupableProps<T extends IterableContainer> = ConditionalKeys<
  ItemsSuperObject<T>,
  PropertyKey | undefined
>;

type AllPropValues<
  T extends IterableContainer,
  Prop extends GroupableProps<T>,
> = Extract<ItemsSuperObject<T>[Prop], PropertyKey>;

type ItemsSuperObject<T extends IterableContainer> = AllUnionFields<
  // If the input tuple contains optional elements they would add `undefined` to
  // T[number] (and could technically show up in the array itself). Because
  // undefined breaks AllUnionFields we need to remove it from the union. This
  // is OK because we handle this in the implementation too.
  Exclude<T[number], undefined>
>;

type FixEmptyObject<T> = IsNever<keyof T> extends true ? EmptyObject : T;

type EnsureValuesAreNonEmpty<T extends Record<PropertyKey, IterableContainer>> =
  Simplify<
    Omit<T, PossiblyEmptyArrayKeys<T>> &
      BoundedPartial<CoercedNonEmptyValues<Pick<T, PossiblyEmptyArrayKeys<T>>>>
  >;

type PossiblyEmptyArrayKeys<T extends Record<PropertyKey, IterableContainer>> =
  keyof T extends infer Key extends unknown
    ? Key extends keyof T
      ? IsNonEmptyArray<T[Key]> extends true
        ? never
        : Key
      : never
    : never;

type IsNonEmptyArray<T extends IterableContainer> =
  IsNonEmptyFixedTuple<TupleParts<T>["required"]> extends true
    ? true
    : IsNonEmptyFixedTuple<TupleParts<T>["suffix"]> extends true
      ? true
      : false;

type IsNonEmptyFixedTuple<T> = IsNever<Extract<T, readonly []>>;

type CoercedNonEmptyValues<T extends Record<PropertyKey, IterableContainer>> = {
  [P in keyof T]: ArrayRequiredPrefix<T[P], 1>;
};
```
