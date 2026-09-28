# Implement zip from remeda

`src/zip.js` is the JavaScript build of `packages/remeda/src/zip.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `zip`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates a new list from two supplied lists by pairing up equally-positioned
 * items. The length of the returned list will match the shortest of the two
 * inputs.
 *
 * @param first - The first input list.
 * @param second - The second input list.
 * @signature
 *   zip(first, second)
 * @example
 *   zip([1, 2], ['a', 'b']) // => [[1, 'a'], [2, 'b']]
 * @dataFirst
 * @lazy
 * @category Array
 */
export function zip(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/first.js`, `src/internal/lazyDataLastImpl.js`, `src/internal/toSingle.js`, `src/internal/utilityEvaluators.js`, `src/map.js`, `src/pipe.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/zip.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/zip.js` erased them.

```ts
type Zipped<Left extends IterableContainer, Right extends IterableContainer> =
  // If the array is empty the output is empty, no surprises
  Left extends readonly []
    ? []
    : Right extends readonly []
      ? []
      : // Are the two inputs both tuples with a non-rest first item?
        Left extends readonly [infer LeftHead, ...infer LeftRest]
        ? Right extends readonly [infer RightHead, ...infer RightRest]
          ? // ...Then take that first item from both and recurse
            [[LeftHead, RightHead], ...Zipped<LeftRest, RightRest>]
          : // Is only one of the inputs a tuple (with a non-rest first item)?
            // Then take that item, and match it with whatever the type of the other *array's* items are.
            [[LeftHead, Right[number]], ...Zipped<LeftRest, Right>]
        : Right extends readonly [infer RightHead, ...infer RightRest]
          ? [[Left[number], RightHead], ...Zipped<Left, RightRest>]
          : // Both inputs are not tuples (with a non-rest first item, they might be tuples with non-rest last item(s))
            // So the output is just the "trivial" zip result.
            [Left[number], Right[number]][];
```
