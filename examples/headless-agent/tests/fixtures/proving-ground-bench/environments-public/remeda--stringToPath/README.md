# Implement stringToPath from remeda

`src/stringToPath.js` is the JavaScript build of `packages/remeda/src/stringToPath.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `stringToPath`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * A utility to allow JSONPath-like strings to be used in other utilities which
 * take an array of path segments as input (e.g. `prop`, `setPath`, etc...).
 * The main purpose of this utility is to act as a bridge between the runtime
 * implementation that converts the path to an array, and the type-system that
 * parses the path string **type** into an array **type**. This type allows us
 * to return fine-grained types and to enforce correctness at the type-level.
 *
 * We **discourage** using this utility for new code. This utility is for legacy
 * code that already contains path strings (which are accepted by Lodash). We
 * strongly recommend using *path arrays* instead as they provide better
 * developer experience via significantly faster type-checking, fine-grained
 * error messages, and automatic typeahead suggestions for each segment of the
 * path.
 *
 * *There are a bunch of limitations to this utility derived from the
 * limitations of the type itself, these are usually edge-cases around deeply
 * nested paths, escaping, whitespaces, and empty segments. This is true even
 * in cases where the runtime implementation can better handle them, this is
 * intentional. See the tests for this utility for more details and the
 * expected outputs*.
 *
 * @param stringPath - A string path.
 * @signature
 *   stringToPath(stringPath)
 * @example
 *   stringToPath('a.b[0].c') // => ['a', 'b', 0, 'c']
 * @dataFirst
 * @category Utility
 */
export function stringToPath<const S extends string>(
  stringPath: S,
): StringToPath<S>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/pipe.js`, `src/purry.js`, `src/setPath.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/stringToPath.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/stringToPath.js` erased them.

```ts
type StringToPath<S> =
  // We can only compute the path type for literals that TypeScript can
  // break down further into parts.
  IsStringLiteral<S> extends true ? StringToPathImpl<S> : (string | number)[];

type StringToPathImpl<S> =
  // We start by checking the 2 quoted variants of the square bracket access
  // syntax. We do this in a single check and not in a subsequent check that
  // would only extract the quoted part so that we can catch cases where the
  // quoted part itself contains square brackets. This allows TypeScript to be
  // "greedy" about what it infers into Quoted and DoubleQuoted.
  S extends `${infer Head}['${infer Quoted}']${infer Tail}`
    ? [...StringToPath<Head>, Quoted, ...StringToPath<Tail>]
    : S extends `${infer Head}["${infer DoubleQuoted}"]${infer Tail}`
      ? [...StringToPath<Head>, DoubleQuoted, ...StringToPath<Tail>]
      : // If we have an unquoted property access we also need to run the
        // contents recursively too (unlike the quoted variants above).
        S extends `${infer Head}[${infer Unquoted}]${infer Tail}`
        ? [
            ...StringToPath<Head>,
            ...StringToPath<Unquoted>,
            ...StringToPath<Tail>,
          ]
        : // Finally, we process any dots one after the other from left to
          // right. TypeScript will be non-greedy here, putting *everything*
          // after the first dot into the Tail.
          S extends `${infer Head}.${infer Tail}`
          ? [...StringToPath<Head>, ...StringToPath<Tail>]
          : // Finally we need to handle the few cases of simple literals.
            "" extends S
            ? // There are some edge-cases where Lodash will try to access an
              // empty property, but those seem nonsensical in practice so we
              // prefer just skipping these cases.
              []
            : // We differ from Lodash in the way we handle numbers. Lodash
              // returns everything in the path as a string, and relies on JS to
              // coerce array accessors to numbers (or the other way around in
              // practice, e.g., `myArray[123] === myArray['123']`), but from a
              // typing perspective the two are not the same and we need the
              // path to be accurate about it.
              S extends `${infer N extends number}`
              ? [
                  // TypeScript considers " 123 " to still extend `${number}`,
                  // but would type is as `string` instead of a literal. We
                  // can use that fact to make sure we only consider simple
                  // number literals as numbers, and take the rest as strings.
                  IsNumericLiteral<N> extends true ? N : S,
                ]
              : // This simplest form of a path is just a single string literal.
                [S];
```
