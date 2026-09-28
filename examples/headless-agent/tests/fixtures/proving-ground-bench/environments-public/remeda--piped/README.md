# Implement piped from remeda

`src/piped.js` is the JavaScript build of `packages/remeda/src/piped.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `piped`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Data-last version of `pipe`. See `pipe` documentation for full details.
 *
 * Use `piped` when you need to pass a transformation as a callback to
 * functions like `map` and `filter`, where the data type can be inferred
 * from the call site.
 *
 * IMPORTANT: `piped` does not work as a "function factory" in order to create
 * standalone utility functions; because TypeScript cannot infer the input data
 * type (without requiring to explicitly define all type params for all
 * functions in the pipe). We recommend defining the function explicitly, and
 * then use `pipe` in its implementation.
 *
 * @signature
 *    piped(...functions)(data);
 * @example
 *    map(
 *      [{ a: 1 }, { a: 2 }, { a: 3 }],
 *      piped(prop('a'), add(1)),
 *    ); //=> [2, 3, 4]
 * @dataLast
 * @category Function
 */
export function piped(...functions: readonly ((input: unknown) => unknown)[])

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/utilityEvaluators.js`, `src/pipe.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/piped.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
