# Implement when from remeda

`src/when.js` is the JavaScript build of `packages/remeda/src/when.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `when`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Conditionally run a function based on a predicate, returning its result (similar to
 * the [`?:` (ternary) operator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Conditional_operator).)
 * If the optional `onFalse` function is not provided, the data will be passed
 * through in those cases.
 *
 * Supports type predicates to refine the types for both branches and the return
 * value.
 *
 * Additional arguments are passed to all functions. In data-first calls, they
 * are taken as variadic arguments; but in data-last calls, they are when the
 * curried function itself is called.
 *
 * For more complex cases check out `conditional`.
 *
 * @param predicate - Decides if the `onTrue` mapper should run or not. If it's
 * a type predicate it also narrows types for the mappers and the return value.
 * @param onTrue - Function to run when the predicate returns `true`.
 * @signature
 *   when(predicate, onTrue)(data, ...extraArgs)
 *   when(predicate, { onTrue, onFalse })(data, ...extraArgs)
 * @example
 *   pipe(data, when(isNullish, constant(42)));
 *   pipe(data, when((x) => x > 3, { onTrue: add(1), onFalse: multiply(2) }));
 *   map(data, when(isNullish, (x, index) => x + index));
 * @dataLast
 * @category Function
 */
export function when(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/constant.js`, `src/countBy.js`, `src/identity.js`, `src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/isDefined.js`, `src/isNot.js`, `src/isNullish.js`, `src/isStrictEqual.js`, `src/isString.js`, `src/map.js`, `src/pipe.js`, `src/prop.js`, `src/purry.js`, `src/toLowerCase.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/when.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
