# Implement mergeAll from remeda

`src/mergeAll.js` is the JavaScript build of `packages/remeda/src/mergeAll.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `mergeAll`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Merges a list of objects into a single object.
 *
 * @param objects - The array of objects.
 * @returns A new object merged with all of the objects in the list. If the list is empty, an empty object is returned.
 * @signature
 *    mergeAll(objects)
 * @example
 *    mergeAll([{ a: 1, b: 1 }, { b: 2, c: 3 }, { d: 10 }]) // => { a: 1, b: 2, c: 3, d: 10 }
 *    mergeAll([]) // => {}
 * @dataFirst
 * @category Array
 */
export function mergeAll(objects: readonly object[]): object

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/mergeAll.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/mergeAll.js` erased them.

```ts
/**
 * Merge a tuple of object types, where props from later objects override earlier props.
 */
type MergeTuple<
  T extends IterableContainer,
  Result = object, // no-op for the first iteration in the successive merges, also infers object as type by default if an empty tuple is used
> = T extends readonly [infer Head, ...infer Rest]
  ? MergeTuple<Rest, Merge<Result, Head>>
  : Result;

type MergeUnion<T extends object> = Simplify<
  SharedUnionFields<T> & Partial<DisjointUnionFields<T>>
>;

type MergeAll<T extends IterableContainer<object>> =
  // determine if it's a tuple or array
  TupleParts<T> extends { item: never }
    ? T extends readonly []
      ? EmptyObject
      : MergeTuple<T>
    : MergeUnion<T[number]> | EmptyObject;
```
