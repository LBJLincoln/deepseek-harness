# Implement hasProp from remeda

`src/hasProp.js` is the JavaScript build of `packages/remeda/src/hasProp.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `hasProp`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Checks if `data` has a prop `key`.
 *
 * Uses [`Object.hasOwn`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/hasOwn)
 * which only checks own properties, skipping properties inherited through the
 * prototype chain.
 *
 * - Use `prop` to read the value.
 *
 * @param data - The object to test.
 * @param key - The key to look up.
 * @signature
 *   hasProp(data, key)
 * @example
 *   hasProp({ a: 1 }, "a"); //=> true
 * @dataFirst
 * @category Guard
 */
export function hasProp(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/pipe.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/hasProp.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/hasProp.js` erased them.

```ts
type NonArray<T> = T extends readonly unknown[] ? never : T;

type HasProp<T, Key extends PropertyKey> = T extends readonly unknown[]
  ? never
  : // Distribute over `T`'s union members so members that don't have `Key`
    // drop out of the narrowed type.
    T extends unknown
    ? Key extends keyof T
      ? // `T &` makes the result structurally a subtype of `T`, satisfying
        // the type-predicate assignability check.
        Simplify<T & Required<Pick<T, Key>>>
      : never
    : never;
```
