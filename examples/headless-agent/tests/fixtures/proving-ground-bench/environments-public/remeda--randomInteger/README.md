# Implement randomInteger from remeda

`src/randomInteger.js` is the JavaScript build of `packages/remeda/src/randomInteger.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `randomInteger`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Generate a random integer between `from` and `to` (inclusive).
 *
 * !Important: This function uses [`Math.random()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/random) under-the-hood, which has two major limitations:
 * 1. It generates 2^52 possible values, so the bigger the range, the less
 * uniform the distribution of values would be, and at ranges larger than that
 * some values would never come up.
 * 2. It is not cryptographically secure and should not be used for security
 * scenarios.
 *
 * @param from - The minimum value.
 * @param to - The maximum value.
 * @returns The random integer.
 * @signature
 *   randomInteger(from, to)
 * @example
 *   randomInteger(1, 10) // => 5
 *   randomInteger(1.5, 2.6) // => 2
 * @dataFirst
 * @category Number
 */
export function randomInteger<From extends number, To extends number>(
  from: From,
  to: To,
): RandomInteger<From, To>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/randomInteger.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/randomInteger.js` erased them.

```ts
type MaxLiteral = 1000;

type RandomInteger<From extends number, To extends number> =
  IsNever<NonNegativeInteger<From>> extends true
    ? number
    : IsNever<NonNegativeInteger<To>> extends true
      ? number
      : IsEqual<From, To> extends true
        ? From
        : GreaterThan<From, To> extends true
          ? never
          : GreaterThanOrEqual<To, MaxLiteral> extends true
            ? number
            : IntRangeInclusive<From, To>;
```
