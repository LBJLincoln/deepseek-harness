# Implement omitBy from remeda

`src/omitBy.js` is the JavaScript build of `packages/remeda/src/omitBy.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `omitBy`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates a shallow copy of the data, and then removes any keys that the
 * predicate rejects. Symbol keys are not passed to the predicate and would be
 * passed through to the output as-is.
 *
 * See `pickBy` for a complementary function which starts with an empty object
 * and adds the entries that the predicate accepts. Because it is additive,
 * symbol keys will not be passed through to the output object.
 *
 * @param data - The target object.
 * @param predicate - A function that takes the value, key, and the data itself
 * and returns `true` if the entry shouldn't be part of the output object, or
 * `false` to keep it. If the function is a type-guard on the value the output
 * type would be narrowed accordingly.
 * @returns A shallow copy of the input object with the rejected entries
 * removed.
 * @signature omitBy(data, predicate)
 * @example
 *    omitBy({a: 1, b: 2, A: 3, B: 4}, (val, key) => key.toUpperCase() === key) // => {a: 1, b: 2}
 * @dataFirst
 * @category Object
 */
export function omitBy(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/constant.js`, `src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/pipe.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/omitBy.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/omitBy.js` erased them.

```ts
type PickSymbolKeys<T extends object> = {
  -readonly [P in keyof T as P extends symbol ? P : never]: T[P];
};

type PartialEnumerableKeys<T extends object> =
  // `extends unknown` is always going to be the case and is used to convert any
  // union into a [distributive conditional type](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-8.html#distributive-conditional-types).
  T extends unknown
    ? Simplify<
        IsBoundedRecord<T> extends true
          ? PickSymbolKeys<T> & {
              -readonly [
                P in keyof T as P extends symbol ? never : P
              ]?: Required<T>[P];
            }
          : // This is the type you'd get from doing:
            // `Object.fromEntries(Object.entries(x))`.
            Record<EnumerableStringKeyOf<T>, EnumerableStringKeyedValueOf<T>>
      >
    : never;

type PartialEnumerableKeysNarrowed<T extends object, S> = Simplify<
  ExactProps<T, S> & PartialProps<T, S> & PickSymbolKeys<T>
>;

type ExactProps<T, S> = {
  -readonly [
    P in keyof T as IsExactProp<T, P, S> extends true ? P : never
  ]: Exclude<T[P], S>;
};

type PartialProps<T, S> = {
  -readonly [
    P in keyof T as IsPartialProp<T, P, S> extends true ? P : never
  ]?: Exclude<T[P], S>;
};

type IsExactProp<T, P extends keyof T, S> = P extends symbol
  ? // Symbols are passed through via the PickSymbolKeys type
    false
  : T[P] extends Exclude<T[P], S>
    ? S extends T[P]
      ? // If S extends the T[P] it means the type the predicate is narrowing to
        // can't narrow the rejected value any further, so we can't say what
        // would happen for a concrete value in runtime (e.g. if T[P] is
        // `number` and S is `1`: `Exclude<number, 1> === number`.
        false
      : true
    : false;

type IsPartialProp<T, P extends keyof T, S> = P extends symbol
  ? // Symbols are passed through via the PickSymbolKeys type
    false
  : IsExactProp<T, P, S> extends true
    ? false
    : IsNever<Exclude<Required<T>[P], S>> extends true
      ? false
      : true;
```
