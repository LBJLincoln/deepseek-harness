# Implement times from remeda

`src/times.js` is the JavaScript build of `packages/remeda/src/times.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `times`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Calls an input function `n` times, returning an array containing the results
 * of those function calls.
 *
 * `fn` is passed one argument: The current value of `n`, which begins at `0`
 * and is gradually incremented to `n - 1`.
 *
 * @param count - A value between `0` and `n - 1`. Increments after each
 * function call.
 * @param fn - The function to invoke. Passed one argument, the current value of
 * `n`.
 * @returns An array containing the return values of all calls to `fn`.
 * @signature
 *    times(count, fn)
 * @example
 *    times(5, identity()); //=> [0, 1, 2, 3, 4]
 * @dataFirst
 * @category Array
 */
export function times(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/add.js`, `src/constant.js`, `src/identity.js`, `src/internal/lazyDataLastImpl.js`, `src/internal/purryFromLazy.js`, `src/internal/utilityEvaluators.js`, `src/map.js`, `src/multiply.js`, `src/pipe.js`, `src/purry.js`, `src/sample.js`, `src/sliceString.js`, `src/unique.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/times.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/times.js` erased them.

```ts
type MAX_LITERAL_SIZE = 46;

type TimesArray<
  T,
  N extends number,
  Iteration extends readonly unknown[] = [],
> = number extends N
  ? // N is not a literal number, we can't deduce the type
    T[]
  : `${N}` extends `-${number}`
    ? // N is non-positive, the mapper will never run
      []
    : `${N}` extends `${infer K extends number}.${number}`
      ? // N is not an integer, we "floor" the number.
        TimesArray<T, K, Iteration>
      : GreaterThan<N, MAX_LITERAL_SIZE> extends true
        ? // We can't build a literal tuple beyond this size, after that we
          // can't add more items to the tuple so we add a rest element instead.
          [...TimesArray<T, MAX_LITERAL_SIZE, Iteration>, ...T[]]
        : N extends Iteration["length"]
          ? // We finished building the output tuple
            []
          : // Add another item to the tuple and recurse.
            [T, ...TimesArray<T, N, [unknown, ...Iteration]>];
```
