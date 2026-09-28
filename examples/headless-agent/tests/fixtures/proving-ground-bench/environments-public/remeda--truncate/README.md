# Implement truncate from remeda

`src/truncate.js` is the JavaScript build of `packages/remeda/src/truncate.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `truncate`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Truncates strings to a maximum length, adding an ellipsis when truncated.
 *
 * Shorter strings are returned unchanged. If the omission marker is longer than
 * the maximum length, it will be truncated as well.
 *
 * The `separator` argument provides more control by optimistically searching
 * for a matching cutoff point, which could be used to avoid truncating in the
 * middle of a word or other semantic boundary.
 *
 * If you just need to limit the total length of the string, without adding an
 * `omission` or optimizing the cutoff point via `separator`, prefer
 * `sliceString` instead, which runs more efficiently.
 *
 * The function counts Unicode characters, not visual graphemes, and may split
 * emojis, denormalized diacritics, or combining characters, in the middle. For
 * display purposes, prefer CSS [`text-overflow: ellipsis`](https://developer.mozilla.org/en-US/docs/Web/CSS/text-overflow#ellipsis)
 * which is locale-aware and purpose-built for this task.
 *
 * @param data - The input string.
 * @param n - The maximum length of the output string. The output will **never**
 * exceed this length.
 * @param options - An optional options object.
 * @param options.omission - The string that is appended to the end of the
 * output *whenever the input string is truncated*. Default: '...'.
 * @param options.separator - A string or regular expression that defines a
 * cutoff point for the truncation. If multiple cutoff points are found, the one
 * closest to `n` will be used, and if no cutoff point is found then the
 * function will fallback to the trivial cutoff point. Regular expressions are
 * also supported. Default: <none> (which is equivalent to `""` or the regular
 * expression `/./`).
 * @signature
 *   truncate(data, n, { omission, separator });
 * @example
 *   truncate("Hello, world!", 8); //=> "Hello..."
 *   truncate(
 *     "cat, dog, mouse",
 *     12,
 *     { omission: "__", separator: ","},
 *   ); //=> "cat, dog__"
 * @dataFirst
 * @category String
 */
export function truncate(
  dataOrN: string | number,
  nOrOptions?: number | TruncateOptions,
  options?: TruncateOptions,
): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/utilityEvaluators.js`, `src/pipe.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/truncate.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/truncate.js` erased them.

```ts
type TruncateOptions = {
  readonly omission?: string;
  readonly separator?: string | RegExp;
};

type Truncate<
  S extends string,
  N extends number,
  Options extends TruncateOptions,
> =
  IsNever<NonNegativeInteger<N>> extends true
    ? // There's nothing we can say about the output without a literal, valid,
      // truncation length `N`.
      string
    : IsStringLiteral<S> extends true
      ? TruncateWithOptions<
          S,
          N,
          // TODO: I don't like how I handled the default options object; I want to have everything coupled between the runtime and the type system, but this feels both brittle to changes, and over-verbose.
          Options extends Pick<Required<TruncateOptions>, "omission">
            ? Options["omission"]
            : typeof DEFAULT_OMISSION,
          Options extends Pick<Required<TruncateOptions>, "separator">
            ? Options["separator"]
            : undefined
        >
      : // There's nothing we can say about the output without a literal input
        // string `S`, the result would always be, at best, just a `string`.
        string;

type TruncateWithOptions<
  S extends string,
  N extends number,
  Omission extends string,
  Separator extends string | RegExp | undefined,
> =
  // Distribute the result over unions.
  N extends unknown
    ? // We can short-circuit most of our logic when N is a literal 0.
      [N] extends [0]
      ? ""
      : // Distribute the result over unions.
        Omission extends unknown
        ? // When Omission isn't literal we don't know how long it is.
          IsStringLiteral<Omission> extends true
          ? // This mirrors the runtime logic where if `n - omission.length`
            // is not positive then what we end up truncating is Omission
            // itself and not S.
            [ClampedIntegerSubtract<N, StringLength<Omission>>] extends [0]
            ? TruncateLiterals<Omission, N, "">
            : // When S isn't literal the output wouldn't be literal either.
              IsStringLiteral<S> extends true
              ? // TODO: Handling non-trivial separators would add a ton of complexity to this type! It's possible (but hard!) to support string literals so I'm leaving this as a TODO; regular expressions are impossible because we can't get the type checker to run them.
                [Separator] extends [undefined]
                ? TruncateLiterals<S, N, Omission>
                : string
              : string
          : string
        : never
    : never;

/**
 * This is the actual implementation of the truncation logic. It assumes all
 * its params are literals and valid.
 */
type TruncateLiterals<
  S extends string,
  N extends number,
  Omission extends string,
  Iteration extends readonly unknown[] = [],
> = S extends `${infer Character}${infer Rest}`
  ? // The cutoff point N - omission.length leaves room for the omission.
    Iteration["length"] extends ClampedIntegerSubtract<
      N,
      StringLength<Omission>
    >
    ? // The string is only truncated if its total length is longer than N; at
      // the cutoff point this is simplified to comparing the remaining suffix
      // length to the omission length.
      IsLongerThan<S, Omission> extends true
      ? Omission
      : S
    : // Reconstruct string character by character until cutoff.
      `${Character}${TruncateLiterals<Rest, N, Omission, [...Iteration, unknown]>}`
  : // Empty input string results in empty output.
    "";

/**
 * An optimized check that efficiently checks if the string A is longer than B.
 */
type IsLongerThan<
  A extends string,
  B extends string,
> = A extends `${string}${infer RestA}`
  ? B extends `${string}${infer RestB}`
    ? IsLongerThan<RestA, RestB>
    : // B is empty and A isn't!
      true
  : // A is empty, even if B is empty, A wouldn't be (strictly) longer.
    false;
```
