# Implement firstBy from remeda

`src/firstBy.js` is the JavaScript build of `packages/remeda/src/firstBy.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `firstBy`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Find the first element in the array that adheres to the order rules provided. This is a superset of what a typical `maxBy` or `minBy` function would do as it allows defining "tie-breaker" rules when values are equal, and allows comparing items using any logic. This function is equivalent to calling `first(sortBy(...))` but runs at *O(n)* instead of *O(nlogn)*.
 *
 * Use `nthBy` if you need an element other that the first, or `takeFirstBy` if you more than just the first element.
 *
 * @param rules - A variadic array of order rules defining the sorting criteria. Each order rule is a projection function that extracts a comparable value from the data. Sorting is based on these extracted values using the native `<` and `>` operators. Earlier rules take precedence over later ones. Use the syntax `[projection, "desc"]` for descending order.
 * @returns The first element by the order criteria, or `undefined` if the array
 * is empty. (The function provides strong typing if the input type assures the
 * array isn't empty).
 * @signature
 *   firstBy(...rules)(data);
 * @example
 *   const max = pipe([1,2,3], firstBy([identity(), "desc"])); // => 3;
 *   const min = pipe([1,2,3], firstBy(identity())); // => 1;
 *
 *   const data = [{ a: "a" }, { a: "aa" }, { a: "aaa" }] as const;
 *   const maxBy = pipe(data, firstBy([(item) => item.a.length, "desc"])); // => { a: "aaa" };
 *   const minBy = pipe(data, firstBy((item) => item.a.length)); // => { a: "a" };
 *
 *   const data = [{type: "cat", size: 1}, {type: "cat", size: 2}, {type: "dog", size: 3}] as const;
 *   const multi = pipe(data, firstBy(prop('type'), [prop('size'), 'desc'])); // => {type: "cat", size: 2}
 * @dataLast
 * @category Array
 */
export function firstBy(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/hasAtLeast.js`, `src/identity.js`, `src/internal/lazyDataLastImpl.js`, `src/internal/purryOrderRules.js`, `src/internal/utilityEvaluators.js`, `src/pipe.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/firstBy.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/firstBy.js` erased them.

```ts
type FirstBy<T extends IterableContainer> =
  | T[number]
  | (T extends readonly [unknown, ...(readonly unknown[])]
      ? never
      : T extends readonly [...(readonly unknown[]), unknown]
        ? never
        : undefined);
```
