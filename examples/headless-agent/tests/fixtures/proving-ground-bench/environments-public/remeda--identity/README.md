# Implement identity from remeda

`src/identity.js` is the JavaScript build of `packages/remeda/src/identity.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `identity`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * A function that returns the first argument passed to it.
 *
 * Notice that this is a dataLast impl where the function needs to be invoked
 * to get the "do nothing" function.
 *
 * See also:
 * * `doNothing` - A function that doesn't return anything.
 * * `constant` - A function that ignores the input arguments and returns the same value on every invocation.
 *
 * @signature
 *    identity();
 * @example
 *    map([1,2,3], identity()); // => [1,2,3]
 * @category Function
 */
export function identity(): IdentityFunction

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/add.js`, `src/constant.js`, `src/countBy.js`, `src/debounce.js`, `src/difference.js`, `src/dropFirstBy.js`, `src/filter.js`, `src/find.js`, `src/firstBy.js`, `src/flat.js`, `src/hasAtLeast.js`, `src/internal/heap.js`, `src/internal/lazyDataLastImpl.js`, `src/internal/purryFromLazy.js`, `src/internal/purryOrderRules.js`, `src/internal/quickSelect.js`, `src/internal/swapInPlace.js`, `src/internal/toSingle.js`, `src/internal/utilityEvaluators.js`, `src/intersection.js`, `src/isStrictEqual.js`, `src/isString.js`, `src/map.js`, `src/meanBy.js`, `src/multiply.js`, `src/nthBy.js`, `src/pipe.js`, `src/prop.js`, `src/pullObject.js`, `src/purry.js`, `src/rankBy.js`, `src/take.js`, `src/takeFirstBy.js`, `src/times.js`, `src/toLowerCase.js`, `src/when.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/identity.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/identity.js` erased them.

```ts
type IdentityFunction = <T>(firstParameter: T, ...rest: any) => T;
```
