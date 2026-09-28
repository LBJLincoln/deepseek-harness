# Implement partialLastBind from remeda

`src/partialLastBind.js` is the JavaScript build of `packages/remeda/src/partialLastBind.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `partialLastBind`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates a function that calls `func` with `partial` put after the arguments
 * it receives. Note that this doesn't support functions with both optional
 * and rest parameters.
 *
 * Can be thought of as "freezing" some portion of a function's arguments,
 * resulting in a new function with a simplified signature.
 *
 * Useful for converting a data-first function to a data-last one.
 *
 * @param func - The function to wrap.
 * @param partial - The arguments to put after.
 * @returns A partially bound function.
 * @signature
 *    partialLastBind(func, ...partial);
 * @example
 *    const fn = (x: number, y: number, z: number) => x * 100 + y * 10 + z;
 *    const partialFn = partialLastBind(fn, 2, 3);
 *    partialFn(1); //=> 123
 *
 *    const parseBinary = partialLastBind(parseInt, "2");
 *    parseBinary("101"); //=> 5
 *
 *    pipe(
 *      { a: 1 },
 *      // instead of (arg) => JSON.stringify(arg, null, 2)
 *      partialLastBind(JSON.stringify, null, 2),
 *    ); //=> '{\n  "a": 1\n}'
 * @dataFirst
 * @category Function
 * @see partialBind
 */
export function partialLastBind<
  F extends StrictFunction,
  SuffixArgs extends TupleSuffix<Parameters<F>>,
  RemovedSuffix extends RemoveSuffix<Parameters<F>, SuffixArgs>,
>(
  func: F,
  ...partial: SuffixArgs
): (
  ...rest: RemovedSuffix extends IterableContainer ? RemovedSuffix : never
) => ReturnType<F>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/partialLastBind.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/partialLastBind.js` erased them.

```ts
type PartialLastBindError<
  Message extends string,
  Metadata = never,
> = RemedaTypeError<"partialLastBind", Message, { metadata: Metadata }>;

type TupleSuffix<T extends IterableContainer> = TupleSplits<T>["right"];

type RemoveSuffix<
  T extends IterableContainer,
  Suffix extends TupleSuffix<T>,
> = Suffix extends readonly []
  ? T
  : T extends readonly [...infer TRest, infer TLast]
    ? Suffix extends readonly [...infer SuffixRest, infer _SuffixLast]
      ? // SuffixLast extends TLast.
        RemoveSuffix<TRest, SuffixRest>
      : // Suffix (as a whole) extends readonly TLast[].
        // Suffix could possibly be empty, so this has to be TLast?.
        [...RemoveSuffix<TRest, Suffix>, TLast?]
    : // T has an optional or rest parameter last. If T is a parameter list,
      // this can only happen if we have optional arguments or a rest param;
      // both cases are similar.
      T extends readonly [...infer TRest, (infer _TLast)?]
      ? Suffix extends readonly [...infer SuffixRest, infer _SuffixLast]
        ? // SuffixLast extends TLast.
          RemoveSuffix<TRest, SuffixRest>
        : // Suffix (as a whole) extends [...TRest, TLast?].
          TRest
      : // We got passed a parameter list that isn't what we expected; this
        // is an internal error.
        PartialLastBindError<"Function parameter list has unexpected shape", T>;
```
