# Implement range from remeda

`src/range.js` is the JavaScript build of `packages/remeda/src/range.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `range`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Returns a sequence of numbers from `start` (inclusive) to `end` (exclusive),
 * adding `step` (default is `1`) to each number in the sequence.
 *
 * @param start - The first number in the sequence.
 * @param endOrOptions - The end number **or** an object which is used to
 * **also** define a step size.
 * @param endOrOptions.end - The non-inclusive end of the range.
 * @param endOrOptions.step - The gap between consecutive numbers.
 * @signature
 *   range(start, end)
 *   range(start, { end, step })
 * @example
 *    range(1, 5); //=> [1, 2, 3, 4]
 *    range(1, { end: 5, step: 2 }); //=> [1, 3]
 * @dataFirst
 * @category Array
 */
export function range(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/map.js`, `src/mapValues.js`, `src/pipe.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/range.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/range.js` erased them.

```ts
type RangeOptions = {
  readonly end: number;
  readonly step: number;
};
```
