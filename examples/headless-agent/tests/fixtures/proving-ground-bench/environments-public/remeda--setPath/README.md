# Implement setPath from remeda

`src/setPath.js` is the JavaScript build of `packages/remeda/src/setPath.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `setPath`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Sets the value at `path` of `object`.
 *
 * For simple cases where the path is only one level deep, prefer `set` instead.
 *
 * @param data - The target method.
 * @param path - The array of properties.
 * @param value - The value to set.
 * @signature
 *    setPath(obj, path, value)
 * @example
 *    setPath({ a: { b: 1 } }, ['a', 'b'], 2) // => { a: { b: 2 } }
 * @dataFirst
 * @category Object
 */
export function setPath(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/pipe.js`, `src/purry.js`, `src/stringToPath.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/setPath.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/setPath.js` erased them.

```ts
type Paths<T, Prefix extends readonly unknown[] = []> =
  | Prefix
  | (T extends object
      ? ValueOf<{
          [K in ProperKeyOf<T>]-?: Paths<T[K], [...Prefix, K]>;
        }>
      : RemedaTypeError<
          "setPath",
          "Can only compute paths objects",
          { type: never; metadata: T }
        >) extends infer Path
  ? // The Paths type is used to define the path param in `setPath`. In order
    // for both mutable arrays and readonly arrays to be supported we need to
    // make all results `readonly` (because mutable arrays extend readonly
    // arrays, but not the other way around). Because the result of Paths is
    // a union of arrays we need to distribute Result so that the operator is
    // applied to each member separately.
    Readonly<Path>
  : never;

/**
 * Array objects have all Array.prototype keys in their "keyof" type, which
 * is not what we'd expect from the operator. We only want the numeric keys
 * which represent proper elements of the array.
 */
type ProperKeyOf<T> = Extract<
  keyof T,
  T extends readonly unknown[] ? number : keyof T
>;

type ValueAtPath<T, Path> = Path extends readonly [
  infer Head extends keyof T,
  ...infer Rest,
]
  ? ValueAtPath<T[Head], Rest>
  : T;
```
