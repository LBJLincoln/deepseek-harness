# Implement pick from remeda

`src/pick.js` is the JavaScript build of `packages/remeda/src/pick.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `pick`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates an object composed of the picked `data` properties.
 *
 * @param keys - The property names.
 * @signature pick([prop1, prop2])(object)
 * @example
 *    pipe({ a: 1, b: 2, c: 3, d: 4 }, pick(['a', 'd'])) // => { a: 1, d: 4 }
 * @dataLast
 * @category Object
 */
export function pick(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/pipe.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/pick.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/pick.js` erased them.

```ts
type PickFromArray<T, Keys extends readonly KeysOfUnion<T>[]> =
  // Distribute unions for both object types and key arrays.
  T extends unknown
    ? Keys extends unknown
      ? // When T is a union (or when Keys is empty) the picked props might
        // not exist in some of its sub-types, e.g.,
        //   `pick(... as { a: string } | { b: number }, ['a'])`,
        // if we simply let the regular "constructive" logic run, the
        // resulting type would be `{}` which doesn't behave like an empty
        // object! instead, we want to use a more explicit *empty* type.
        IsNever<Extract<Keys[number], keyof T>> extends true
        ? EmptyObject
        : // Remove `readonly` modifiers from picked props since we return a
          // new, mutable, object. We don't wrap the result with `Simplify` to
          // flatten it because `Writable` does the same thing implicitly.
          Writable<
            IsBoundedRecord<T> extends true
              ? PickBoundedFromArray<T, Keys>
              : PickUnbounded<T, Extract<Keys[number], keyof T>>
          >
      : never
    : never;

/**
 * Bounded records have bounded keys and result in a bounded output. The only
 * question left is whether to add the prop as-is, or make it optional. This
 * can be determined by the part of the keys array the prop is defined in, and
 * the way that element is defined: if the array contains a singular literal
 * key in either the required prefix or the suffix, we know that prop should be
 * picked as-is, otherwise, the key might not be present in the keys array so it
 * can only be picked optionally.
 */
type PickBoundedFromArray<T, Keys extends readonly KeysOfUnion<T>[]> =
  // Literal keys in the prefix/suffix are guaranteed present.
  Pick<
    T,
    // When T is a union the keys need to be narrowed to just those that are
    // keys of the specific sub-type being built
    Extract<
      | PartitionByUnion<TupleParts<Keys>["required"]>["singular"]
      | PartitionByUnion<TupleParts<Keys>["suffix"]>["singular"],
      keyof T
    >
  > &
    // Union keys, optional elements, and rest elements are optional.
    Partial<
      Pick<
        T,
        // When T is a union the keys need to be narrowed to just those that are
        // keys of the specific sub-type being built.
        Extract<
          | PartitionByUnion<TupleParts<Keys>["required"]>["union"]
          // TODO: the optional part of the keys array will always be empty because its impossible to provide the pick function with a tuple with optional elements; this is because optional elements are always implicitly `undefined` too; which breaks the constraint that all keys are keys of T (`undefined` is not a key of anything). We can lift this restriction by supporting `undefined` in the runtime and relaxing the type constraint to allow it, but this relaxed constraint enables a niche feature (optional tuple elements) at the expense of better type-safety for the more common cases of fixed tuples and arrays. Anyway... if we ever change it, this part of the output type will ensure the output is still correct:
          | TupleParts<Keys>["optional"][number]
          | TupleParts<Keys>["item"]
          | PartitionByUnion<TupleParts<Keys>["suffix"]>["union"],
          keyof T
        >
      >
    >;

/**
 * The built-in `Pick` is weird when it comes to picking bounded keys from
 * unbounded records. It reconstructs the output object regardless of the shape
 * of the input: `Pick<Record<string, "world">, "hello">` results in the type
 * `{ hello: "world" }`, but you'd expect it to be optional because we don't
 * know if the record contains a `hello` prop or not!
 *
 * !Important: We assume T is unbounded and don't test for it!
 *
 * See: https://www.typescriptlang.org/play/?#code/PTAEE0HsFcHIBNQFMAeAHJBjALqAGqNpKAEZKigAGA3qABZIA2jkA-AFygBEA7pAE6N4XUAF9KAGlLRcAQ0ayAzgChsATwz5QAXlAAFAJaYA1gB4ASlgHxTi7PwMA7AOZTeAoVwB8bhs0jeANzKIBSgAHqsykA.
 */
type PickUnbounded<T, Keys extends keyof T> =
  IsBounded<Keys> extends true ? Partial<Pick<T, Keys>> : Pick<T, Keys>;
```
