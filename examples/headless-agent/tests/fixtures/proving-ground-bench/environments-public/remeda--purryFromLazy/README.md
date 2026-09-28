# Implement purryFromLazy from remeda

`src/internal/purryFromLazy.js` is the JavaScript build of `packages/remeda/src/internal/purryFromLazy.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `purryFromLazy`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * A version of `purry` for cases where the only meaningful implementation is a
 * lazy one. This is useful for functions that don't have a built-in
 * implementation already, and that can't be optimized to take advantage of
 * having the complete array upfront.
 *
 * Under the hood the function uses `pipe` to utilize it's built-in lazy logic
 * and wraps the pipe with the required invocations to allow using the function
 * outside of pipes too.
 *
 * @param lazy - The main lazy implementation, it assumes that data is an
 * iterable (array-like).
 * @param args - The arguments passed to the overloaded invocation.
 * @see purry
 * @see pipe
 */
export function purryFromLazy(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lazy: (...args: any) => LazyEvaluator,
  args: readonly unknown[],
): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/filter.js`, `src/flat.js`, `src/identity.js`, `src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/map.js`, `src/pipe.js`, `src/prop.js`, `src/purry.js`, `src/take.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/internal/purryFromLazy.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
