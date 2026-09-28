# Implement entries from remeda

`src/entries.js` is the JavaScript build of `packages/remeda/src/entries.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `entries`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Returns an array of key/values of the enumerable properties of an object.
 *
 * @param data - Object to return keys and values of.
 * @signature
 *    entries(object)
 * @example
 *    entries({ a: 1, b: 2, c: 3 }); // => [['a', 1], ['b', 2], ['c', 3]]
 * @dataFirst
 * @category Object
 */
export function entries(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/entries.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/entries.js` erased them.

```ts
type Entry<T> = Simplify<
  ValueOf<{
    // `Object.entries` only returns enumerable keys, skipping symbols.
    [P in Exclude<keyof T, symbol>]-?: [
      // and all keys are converted to strings.
      key: ToString<P>,
      // Optionality doesn't play a factor in the result of entries because its
      // a typing thing, not a runtime thing. We need to remove any `undefined`
      // added just because the prop is optional.
      value: Required<T>[P],
    ];
  }>
>;
```
