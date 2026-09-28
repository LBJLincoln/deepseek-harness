# Implement split from remeda

`src/split.js` is the JavaScript build of `packages/remeda/src/split.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `split`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Splits a string into an array of substrings using a separator pattern.
 *
 * This function is a wrapper around the built-in [`String.prototype.split`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/split)
 * method.
 *
 * @param data - The string to split.
 * @param separator - The pattern describing where each split should occur. Can
 * be a string, or a regular expression.
 * @param limit - A non-negative integer specifying a limit on the number of
 * substrings to be included in the array. If provided, splits the string at
 * each occurrence of the specified separator, but stops when limit entries have
 * been placed in the array. Any leftover text is not included in the array at
 * all. The array may contain fewer entries than limit if the end of the string
 * is reached before the limit is reached. If limit is 0, [] is returned.
 * @returns An array of strings, split at each point where the separator occurs
 * in the given string.
 * @signature
 *   split(data, separator, limit);
 * @example
 *   split("a,b,c", ","); //=> ["a", "b", "c"]
 *   split("a,b,c", ",", 2); //=> ["a", "b"]
 *   split("a1b2c3d", /\d/u); //=> ["a", "b", "c", "d"]
 * @dataFirst
 * @category String
 */
export function split(
  dataOrSeparator: RegExp | string,
  separatorOrLimit?: RegExp | number | string,
  limit?: number,
): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/utilityEvaluators.js`, `src/pipe.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/split.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/split.js` erased them.

```ts
type BuiltInReturnType = ReturnType<typeof String.prototype.split>;

type Split<
  S extends string,
  Separator extends string,
  N extends number | undefined = undefined,
> = string extends S
  ? BuiltInReturnType
  : string extends Separator
    ? BuiltInReturnType
    : number extends N
      ? BuiltInReturnType
      : // TODO: We need a way to "floor" non-integer numbers, until then we return a lower fidelity type instead.
        IsFloat<N> extends true
        ? BuiltInReturnType
        : N extends number
          ? ArraySlice<SplitBase<S, Separator>, 0, NonNegative<N>>
          : SplitBase<S, Separator>;
```
