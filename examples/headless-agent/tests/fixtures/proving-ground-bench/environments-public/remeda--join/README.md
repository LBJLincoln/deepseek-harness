# Implement join from remeda

`src/join.js` is the JavaScript build of `packages/remeda/src/join.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `join`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Joins the elements of the array by: casting them to a string and
 * concatenating them one to the other, with the provided glue string in between
 * every two elements.
 *
 * When called on a tuple and with stricter item types (union of literal values,
 * the result is strictly typed to the tuples shape and it's item types).
 *
 * @param data - The array to join.
 * @param glue - The string to put in between every two elements.
 * @signature
 *    join(data, glue)
 * @example
 *    join([1,2,3], ",") // => "1,2,3" (typed `string`)
 *    join(['a','b','c'], "") // => "abc" (typed `string`)
 *    join(['hello', 'world'] as const, " ") // => "hello world" (typed `hello world`)
 * @dataFirst
 * @category Array
 */
export function join(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/join.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/join.js` erased them.

```ts
type JoinableItem = bigint | boolean | number | string | null | undefined;
```
