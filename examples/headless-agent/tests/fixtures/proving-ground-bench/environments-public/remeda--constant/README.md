# Implement constant from remeda

`src/constant.js` is the JavaScript build of `packages/remeda/src/constant.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `constant`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * A function that takes any arguments and returns the provided `value` on every
 * invocation. This is useful to provide trivial implementations for APIs or in
 * combination with a ternary or other conditional execution to allow to short-
 * circuit more complex implementations for a specific case.
 *
 * Notice that this is a dataLast impl where the function needs to be invoked
 * to get the "do nothing" function.
 *
 * See also:
 * `doNothing` - A function that doesn't return anything.
 * `identity` - A function that returns the first argument it receives.
 *
 * @param value - The constant value that would be returned on every invocation.
 * The value is not copied/cloned on every invocation so care should be taken
 * with mutable objects (like arrays, objects, Maps, etc...).
 * @signature
 *   constant(value);
 * @example
 *   map([1, 2, 3], constant('a')); // => ['a', 'a', 'a']
 *   map(
 *     [1, 2, 3],
 *     isDemoMode ? add(1) : constant(0),
 *   ); // => [2, 3, 4] or [0, 0, 0]
 * @dataLast
 * @category Function
 */
export function constant<const T>(
  value: T,
): // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- There is no other way to make typescript infer the function arguments "backwards" in data-last invocations without the Args type parameter. @see: https://github.com/typescript-eslint/typescript-eslint/issues/9887
<Args extends readonly unknown[]>(...args: Args) => T

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/add.js`, `src/conditional.js`, `src/countBy.js`, `src/debounce.js`, `src/evolve.js`, `src/filter.js`, `src/hasAtLeast.js`, `src/identity.js`, `src/internal/lazyDataLastImpl.js`, `src/internal/purryOn.js`, `src/internal/utilityEvaluators.js`, `src/isDeepEqual.js`, `src/isDefined.js`, `src/isNot.js`, `src/isNullish.js`, `src/isStrictEqual.js`, `src/isString.js`, `src/length.js`, `src/map.js`, `src/mapKeys.js`, `src/mapValues.js`, `src/multiply.js`, `src/omit.js`, `src/omitBy.js`, `src/pickBy.js`, `src/pipe.js`, `src/prop.js`, `src/pullObject.js`, `src/purry.js`, `src/reduce.js`, `src/set.js`, `src/sliceString.js`, `src/take.js`, `src/times.js`, `src/toLowerCase.js`, `src/when.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/constant.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
