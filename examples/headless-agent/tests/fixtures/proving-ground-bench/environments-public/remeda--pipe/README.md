# Implement pipe from remeda

`src/pipe.js` is the JavaScript build of `packages/remeda/src/pipe.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `pipe`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Performs left-to-right function composition, passing data through functions
 * in sequence. Each function receives the output of the previous function,
 * creating a readable top-to-bottom data flow that matches how the
 * transformation is executed. This enables converting deeply nested function
 * calls into clear, sequential steps without temporary variables.
 *
 * When consecutive functions with a `lazy` tag (e.g., `map`, `filter`, `take`,
 * `drop`, `forEach`, etc...) are used together, they process data item-by-item
 * rather than creating intermediate arrays. This enables early termination
 * when only partial results are needed, improving performance for large
 * datasets and expensive operations.
 *
 * Functions are only evaluated lazily when their data-last form is used
 * directly in the pipe. To disable lazy evaluation, use data-first calls via
 * arrow functions: `($) => map($, callback)` instead of `map(callback)`.
 *
 * Any function can be used in pipes, not just Remeda utilities. For creating
 * custom functions with currying and lazy evaluation support, see the `purry`
 * utility.
 *
 * A "headless" variant `piped` is available for creating reusable pipe
 * functions without initial data.
 *
 * IMPORTANT: During lazy evaluation, callbacks using the third parameter (the
 * input array) receive only items processed up to that point, not the complete
 * array.
 *
 * @param data - The input data.
 * @param functions - A sequence of functions that take one argument and
 * return a value.
 * @signature
 *   pipe(data, ...functions);
 * @example
 *    pipe([1, 2, 3], map(multiply(3))); //=> [3, 6, 9]
 *
 *    // = Early termination with lazy evaluation =
 *    pipe(
 *      hugeArray,
 *      map(expensiveComputation),
 *      filter(complexPredicate),
 *      // Only processes items until 2 results are found, then stops.
 *      // Most of hugeArray never gets processed.
 *      take(2),
 *    );
 *
 *    // = Custom logic within a pipe =
 *    pipe(
 *      input,
 *      toLowerCase(),
 *      normalize,
 *      ($) => validate($, CONFIG),
 *      split(","),
 *      unique(),
 *    );
 *
 *    // = Migrating nested transformations to pipes =
 *    // Nested
 *    const result = prop(
 *      mapValues(groupByProp(users, "department"), length()),
 *      "engineering",
 *    );
 *
 *    // Piped
 *    const result = pipe(
 *      users,
 *      groupByProp("department"),
 *      mapValues(length()),
 *      prop("engineering"),
 *    );
 *
 *    // = Using the 3rd param of a callback =
 *    // The following would print out `data` in its entirety for each value
 *    // of `data`.
 *    forEach([1, 2, 3, 4], (_item, _index, data) => {
 *      console.log(data);
 *    }); //=> "[1, 2, 3, 4]" logged 4 times
 *
 *    // But with `pipe` data would only contain the items up to the current
 *    // index
 *    pipe([1, 2, 3, 4], forEach((_item, _index, data) => {
 *      console.log(data);
 *    })); //=> "[1]", "[1, 2]", "[1, 2, 3]", "[1, 2, 3, 4]"
 * @dataFirst
 * @category Function
 */
export function pipe(
  input: unknown,
  ...functions: readonly (LazyFunction | ((value: unknown) => unknown))[]
): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/add.js`, `src/addProp.js`, `src/capitalize.js`, `src/concat.js`, `src/conditional.js`, `src/constant.js`, `src/countBy.js`, `src/difference.js`, `src/drop.js`, `src/dropFirstBy.js`, `src/dropLastWhile.js`, `src/dropWhile.js`, `src/endsWith.js`, `src/evolve.js`, `src/filter.js`, `src/find.js`, `src/findIndex.js`, `src/findLast.js`, `src/findLastIndex.js`, `src/first.js`, `src/firstBy.js`, `src/flat.js`, `src/forEachObj.js`, `src/fromEntries.js`, `src/fromKeys.js`, `src/groupBy.js`, `src/groupByProp.js`, `src/hasAtLeast.js`, `src/hasProp.js`, `src/hasSubObject.js`, `src/identity.js`, `src/indexBy.js`, `src/internal/heap.js`, `src/internal/lazyDataLastImpl.js`, `src/internal/purryFromLazy.js`, `src/internal/purryOn.js`, `src/internal/purryOrderRules.js`, `src/internal/quickSelect.js`, `src/internal/swapInPlace.js`, `src/internal/toSingle.js`, `src/internal/utilityEvaluators.js`, `src/internal/words.js`, `src/intersection.js`, `src/invert.js`, `src/isDeepEqual.js`, `src/isDefined.js`, `src/isIncludedIn.js`, `src/isNot.js`, `src/isNullish.js`, `src/isNumber.js`, `src/isStrictEqual.js`, `src/isString.js`, `src/last.js`, `src/length.js`, `src/map.js`, `src/mapKeys.js`, `src/mapToObj.js`, `src/mapValues.js`, `src/mapWithFeedback.js`, `src/mean.js`, `src/meanBy.js`, `src/median.js`, `src/multiply.js`, `src/nthBy.js`, `src/omit.js`, `src/omitBy.js`, `src/only.js`, `src/partition.js`, `src/pathOr.js`, `src/pick.js`, `src/pickBy.js`, `src/product.js`, `src/prop.js`, `src/pullObject.js`, `src/purry.js`, `src/range.js`, `src/reduce.js`, `src/reverse.js`, `src/set.js`, `src/setPath.js`, `src/shuffle.js`, `src/sliceString.js`, `src/sort.js`, `src/sortBy.js`, `src/splice.js`, `src/split.js`, `src/startsWith.js`, `src/stringToPath.js`, `src/sum.js`, `src/sumBy.js`, `src/swapProps.js`, `src/take.js`, `src/takeFirstBy.js`, `src/takeLastWhile.js`, `src/takeWhile.js`, `src/tap.js`, `src/times.js`, `src/toCamelCase.js`, `src/toKebabCase.js`, `src/toLowerCase.js`, `src/toSnakeCase.js`, `src/toTitleCase.js`, `src/toUpperCase.js`, `src/truncate.js`, `src/uncapitalize.js`, `src/when.js`, `src/zip.js`, `src/zipWith.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/pipe.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/pipe.js` erased them.

```ts
type LazyStep = {
  readonly lazyEvaluator: LazyEvaluator;
  readonly isSingle: boolean;
  // Notice the array is mutable, we will be adding items as the pipe is
  // evaluating them.
  readonly items: unknown[];
};

type LazyFunction = LazyDefinition & ((input: unknown) => unknown);
```
