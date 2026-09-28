# Implement values from remeda

`src/values.js` is the JavaScript build of `packages/remeda/src/values.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `values`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Returns a new array containing the values of the array or object.
 *
 * @param data - Either an array or an object.
 * @signature
 *    values(source)
 * @example
 *    values(['x', 'y', 'z']) // => ['x', 'y', 'z']
 *    values({ a: 'x', b: 'y', c: 'z' }) // => ['x', 'y', 'z']
 * @dataFirst
 * @category Object
 */
export function values(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/values.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/values.js` erased them.

```ts
type Values<T extends object> = T extends IterableContainer
  ? T[number][]
  : EnumerableStringKeyedValueOf<T>[];
```
