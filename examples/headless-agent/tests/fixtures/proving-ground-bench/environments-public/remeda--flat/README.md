# Implement flat from remeda

`src/flat.js` is the JavaScript build of `packages/remeda/src/flat.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `flat`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates a new array with all sub-array elements concatenated into it
 * recursively up to the specified depth. Equivalent to the built-in
 * `Array.prototype.flat` method.
 *
 * @param data - The items to flatten.
 * @param depth - The depth level specifying how deep a nested array structure
 * should be flattened. Defaults to 1. Non literal values (those typed as
 * `number`cannot be used. `Infinity`, `Number.POSITIVE_INFINITY` and
 * `Number.MAX_VALUE` are all typed as `number` and can't be used either. For
 * "unlimited" depth use a literal value that would exceed your expected
 * practical maximum nesting level.
 * @signature
 *   flat(data)
 *   flat(data, depth)
 * @example
 *   flat([[1, 2], [3, 4], [5], [[6]]]); // => [1, 2, 3, 4, 5, [6]]
 *   flat([[[1]], [[2]]], 2); // => [1, 2]
 * @dataFirst
 * @lazy
 * @category Array
 */
export function flat(
  dataOrDepth?: IterableContainer | number,
  depth?: number,
): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/filter.js`, `src/identity.js`, `src/internal/lazyDataLastImpl.js`, `src/internal/purryFromLazy.js`, `src/internal/utilityEvaluators.js`, `src/map.js`, `src/pipe.js`, `src/prop.js`, `src/purry.js`, `src/take.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/flat.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/flat.js` erased them.

```ts
type FlatArray<
  T,
  Depth extends number,
  Iteration extends readonly unknown[] = [],
> = Depth extends Iteration["length"]
  ? // Stopping condition for the recursion when the array is a tuple.
    T
  : T extends readonly []
    ? // Trivial result when the array is empty.
      []
    : T extends readonly [infer Item, ...infer Rest]
      ? // Tuples could be special-cased by "iterating" over each item
        // separately so that we maintain more information from the input type,
        // instead of putting all values in a union.
        [
          ...(Item extends IterableContainer
            ? // If the item itself is an array we continue going deeper
              FlatArray<Item, Depth, [...Iteration, unknown]>
            : // But if it isn't we add it to the output tuple
              [Item]),
          // And we merge this with the result from the rest of the tuple.
          ...FlatArray<Rest, Depth, Iteration>,
        ]
      : // For simple arrays we compute the item type, and wrap it with an
        // array.
        FlatSimpleArrayItems<T, Depth, Iteration>[];

type FlatSimpleArrayItems<
  T,
  Depth extends number,
  Iteration extends readonly unknown[] = [],
  IsDone extends boolean = false,
> = {
  done: T;
  recur: T extends readonly (infer InnerArr)[]
    ? FlatSimpleArrayItems<
        InnerArr,
        Depth,
        [...Iteration, unknown],
        // This trick allows us to continue 1 iteration more than the depth,
        // which is required to flatten the array up to depth.
        Iteration["length"] extends Depth ? true : false
      >
    : T;
}[IsDone extends true ? "done" : "recur"];
```
