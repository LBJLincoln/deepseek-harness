# Implement partialBind from remeda

`src/partialBind.js` is the JavaScript build of `packages/remeda/src/partialBind.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `partialBind`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates a function that calls `func` with `partial` put before the arguments
 * it receives.
 *
 * Can be thought of as "freezing" some portion of a function's arguments,
 * resulting in a new function with a simplified signature.
 *
 * @param func - The function to wrap.
 * @param partial - The arguments to put before.
 * @returns A partially bound function.
 * @signature
 *    partialBind(func, ...partial);
 * @example
 *    const fn = (x: number, y: number, z: number) => x * 100 + y * 10 + z;
 *    const partialFn = partialBind(fn, 1, 2);
 *    partialFn(3); //=> 123
 *
 *    const logWithPrefix = partialBind(console.log, "[prefix]");
 *    logWithPrefix("hello"); //=> "[prefix] hello"
 * @dataFirst
 * @category Function
 * @see partialLastBind
 */
export function partialBind<
  F extends StrictFunction,
  PrefixArgs extends TuplePrefix<Parameters<F>>,
  RemovedPrefix extends RemovePrefix<Parameters<F>, PrefixArgs>,
>(
  func: F,
  ...partial: PrefixArgs
): (
  ...rest: RemovedPrefix extends IterableContainer ? RemovedPrefix : never
) => ReturnType<F>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/partialBind.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/partialBind.js` erased them.

```ts
type PartialBindError<
  Message extends string,
  Metadata = never,
> = RemedaTypeError<"partialBind", Message, { metadata: Metadata }>;

type TuplePrefix<T extends IterableContainer> = TupleSplits<T>["left"];

type RemovePrefix<
  T extends IterableContainer,
  Prefix extends TuplePrefix<T>,
> = Prefix extends readonly []
  ? T
  : T extends readonly [infer THead, ...infer TRest]
    ? Prefix extends readonly [infer _PrefixHead, ...infer PrefixRest]
      ? // PrefixHead extends THead.
        RemovePrefix<TRest, PrefixRest>
      : // Prefix (as a whole) extends readonly THead[].
        // Prefix could possibly be empty, so this has to be THead?.
        [THead?, ...RemovePrefix<TRest, Prefix>]
    : // T has an optional or rest parameter last. If T is a parameter list,
      // this can only happen if we have optional arguments or a rest param;
      // both cases are similar.
      T extends readonly [(infer _THead)?, ...infer TRest]
      ? Prefix extends readonly [infer _PrefixHead, ...infer PrefixRest]
        ? // PrefixHead extends THead.
          RemovePrefix<TRest, PrefixRest>
        : // Prefix (as a whole) extends [THead?, ...TRest].
          TRest
      : // We got passed a parameter list that isn't what we expected; this is
        // an internal error.
        PartialBindError<"Function parameter list has unexpected shape", T>;
```
