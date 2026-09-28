# Implement fromEntries from remeda

`src/fromEntries.js` is the JavaScript build of `packages/remeda/src/fromEntries.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `fromEntries`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates a new object from an array of tuples by pairing up first and second elements as {[key]: value}.
 * If a tuple is not supplied for any element in the array, the element will be ignored
 * If duplicate keys exist, the tuple with the greatest index in the input array will be preferred.
 *
 * The strict option supports more sophisticated use-cases like those that would
 * result when calling the strict `toPairs` function.
 *
 * There are several other functions that could be used to build an object from
 * an array:
 * * `fromKeys` - Builds an object from an array of *keys* and a mapper for values.
 * * `indexBy` - Builds an object from an array of *values* and a mapper for keys.
 * * `pullObject` - Builds an object from an array of items with mappers for *both* keys and values.
 * Refer to the docs for more details.
 *
 * @param entries - An array of key-value pairs.
 * @signature
 *   fromEntries(tuples)
 * @example
 *   fromEntries([['a', 'b'], ['c', 'd']]); // => {a: 'b', c: 'd'}
 * @dataFirst
 * @category Object
 */
export function fromEntries(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/pipe.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/fromEntries.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/fromEntries.js` erased them.

```ts
type FromEntriesError<Message extends string> = RemedaTypeError<
  "fromEntries",
  Message
>;

type Entry<Key extends PropertyKey = PropertyKey, Value = unknown> = readonly [
  key: Key,
  value: Value,
];

type FromEntries<Entries> = Entries extends readonly [
  infer First,
  ...infer Tail,
]
  ? FromEntriesTuple<First, Tail>
  : Entries extends readonly [...infer Head, infer Last]
    ? FromEntriesTuple<Last, Head>
    : Entries extends IterableContainer<Entry>
      ? FromEntriesArray<Entries>
      : FromEntriesError<"Entries array-like could not be inferred">;

type FromEntriesTuple<E, Rest> = E extends Entry
  ? FromEntries<Rest> & Record<E[0], E[1]>
  : FromEntriesError<"Array-like contains a non-entry element">;

type FromEntriesArray<Entries extends IterableContainer<Entry>> =
  string extends AllKeys<Entries>
    ? Record<string, Entries[number][1]>
    : number extends AllKeys<Entries>
      ? Record<number, Entries[number][1]>
      : symbol extends AllKeys<Entries>
        ? Record<symbol, Entries[number][1]>
        : FromEntriesArrayWithLiteralKeys<Entries>;

type FromEntriesArrayWithLiteralKeys<Entries extends IterableContainer<Entry>> =
  {
    [P in AllKeys<Entries>]?: ValueForKey<Entries, P>;
  };

type AllKeys<Entries extends IterableContainer<Entry>> = Extract<
  Entries[number],
  Entry
>[0];

type ValueForKey<
  Entries extends IterableContainer<Entry>,
  K extends PropertyKey,
> = (IsNever<Extract<Entries[number], Entry<K>>> extends true
  ? Entries[number]
  : Extract<Entries[number], Entry<K>>)[1];
```
