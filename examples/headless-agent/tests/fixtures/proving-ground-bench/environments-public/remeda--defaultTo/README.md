# Implement defaultTo from remeda

`src/defaultTo.js` is the JavaScript build of `packages/remeda/src/defaultTo.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `defaultTo`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * A stricter wrapper around the [Nullish coalescing operator `??`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Nullish_coalescing_operator)
 * that ensures that the fallback matches the type of the data. Only works
 * when data can be `null` or `undefined`.
 *
 * Notice that `Number.NaN` is not nullish and would not result in returning the
 * fallback!
 *
 * @param data - A nullish value.
 * @param fallback - A value of the same type as `data` that would be returned
 * when `data` is nullish.
 * @signature
 *   defaultTo(data, fallback);
 * @example
 *   defaultTo("hello" as string | undefined, "world"); //=> "hello"
 *   defaultTo(undefined as string | undefined, "world"); //=> "world"
 * @dataFirst
 * @category Other
 */
export function defaultTo(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/defaultTo.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/defaultTo.js` erased them.

```ts
type FallbackOf<T> =
  IsEqual<T, NonNullable<T>> extends true
    ? RemedaTypeError<
        "defaultTo",
        "no unnecessary fallback",
        // The type is `never` because it will never be used ;)
        { type: never; metadata: T }
      >
    : T;
```
