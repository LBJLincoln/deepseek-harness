# Implement startsWith from remeda

`src/startsWith.js` is the JavaScript build of `packages/remeda/src/startsWith.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `startsWith`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * **NOTE**: every possible value of `data` starts with every possible value of
 * `prefix` meaning the check can't fail; so the result is typed as a
 * **literal `true`**.
 *
 * @param data - The input string.
 * @param prefix - The string to check for at the beginning.
 * @hidden
 */
export function startsWith(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/pipe.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/startsWith.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/startsWith.js` erased them.

```ts
type StartsWith<T, Prefix extends string> = T & `${Prefix}${string}`;

type IsDisjointPrefix<T extends string, Prefix extends string> =
  // The tuple wrapping keeps the checks decidable while `T` or `Prefix` is an
  // unresolved type parameter (a generic wrapper around the function):
  // TypeScript probes a deferred conditional with a wildcard type, which bare
  // `string extends T` resolves to, leaving the rejection branch a live
  // candidate that no argument satisfies; `[string] extends [T]` resolves to
  // `false` and rules it out.
  [string] extends [Prefix]
    ? // A primitive prefix could hold any value at runtime, so a check with it
      // is never provably dead.
      false
    : [string] extends [T]
      ? // A primitive string could hold any value at runtime, so a prefix is
        // never provably dead for it.
        false
      : IsNever<StartsWith<T, Prefix>>;

type IsGuaranteedPrefix<T extends string, Prefix extends string> = [T] extends [
  StartsWithEvery<T, Prefix>,
]
  ? true
  : false;

type DisjointPrefixError<Prefix extends string> = RemedaTypeError<
  "startsWith",
  "This prefix doesn't match any of the inputs, the function will always return `false`",
  {
    // A `string` base is already satisfied by any prefix argument, so the
    // assignability failure is reported on the tag, which carries the
    // message.
    type: string;
    metadata: Prefix;
  }
>;

type StartsWithEvery<T, Prefix extends string> = T &
  // 4. And then we intersect the prefixes instead of adding them to a union to
  // flip the semantics from "OR" to "AND", so that the resulting prefix
  // limitation is the tightest possible combination of all prefixes, and not
  // the widest one, before unwrapping the box.
  Boxed.Extract<
    UnionToIntersection<
      // 1. We first distribute the union to compute the prefix for each member
      // of the union separately (otherwise the prefix itself would contain
      // the union).
      Prefix extends unknown
        ? // 3. Each prefix is boxed so that it survives as a distinct union
          // member until the intersection. Unboxed, a `never` would vanish from
          // the union instead of emptying the intersection, and an empty
          // prefix's `string` would absorb its siblings via subtype reduction.
          Boxed<
            // 2. Unbounded template strings represent infinite possible
            // prefixes, which is exactly the kind of uncertainty that we are
            // working to resolve here, only literals are workable here.
            IsStringLiteral<Prefix> extends true ? `${Prefix}${string}` : never
          >
        : never
    >
  >;

type IsNarrowingUnsound<T, Prefix extends string> = IsEqual<
  // We simulate the falsy branch using the actual narrowing type we use and
  // the type created by narrowing via *all* union members together.
  IsEqual<
    Exclude<T, StartsWith<T, Prefix>>,
    Exclude<T, StartsWithEvery<T, Prefix>>
  >,
  // We want to find the cases where they don't agree, this means that narrowing
  // would result in an unsound overly-narrow falsy branch.
  false
>;
```
