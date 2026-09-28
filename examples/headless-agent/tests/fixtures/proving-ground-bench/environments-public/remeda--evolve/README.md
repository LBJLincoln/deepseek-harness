# Implement evolve from remeda

`src/evolve.js` is the JavaScript build of `packages/remeda/src/evolve.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `evolve`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates a new object by applying functions that is included in `evolver` object parameter
 * to the `data` object parameter according to their corresponding path.
 *
 * Functions included in `evolver` object will not be invoked
 * if its corresponding key does not exist in the `data` object.
 * Also, values included in `data` object will be kept as is
 * if its corresponding key does not exist in the `evolver` object.
 *
 * @param object - Object whose value is applied to the corresponding function
 * that is defined in `evolver` at the same path.
 * @param evolver - Object that include functions that is applied to
 * the corresponding value of `data` object at the same path.
 * @signature
 *    evolve(data, evolver)
 * @example
 *    const evolver = {
 *      count: add(1),
 *      time: { elapsed: add(1), remaining: add(-1) },
 *    };
 *    const data = {
 *      id: 10,
 *      count: 10,
 *      time: { elapsed: 100, remaining: 1400 },
 *    };
 *    evolve(data, evolver)
 *    // => {
 *    //   id: 10,
 *    //   count: 11,
 *    //   time: { elapsed: 101, remaining: 1399 },
 *    // }
 * @dataFirst
 * @category Object
 */
export function evolve(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/add.js`, `src/constant.js`, `src/hasAtLeast.js`, `src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/length.js`, `src/map.js`, `src/omit.js`, `src/pipe.js`, `src/purry.js`, `src/reduce.js`, `src/set.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/evolve.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/evolve.js` erased them.

```ts
/**
 * Basic structure of `evolver` parameter of the function `evolve`.
 */
type GenericEvolver = {
  readonly [P in string]: GenericEvolver | ((data: unknown) => unknown);
};

/**
 * Creates an assumed `evolver` type from the type of `data` argument.
 *
 * @example
 * interface Data {
 *   id: number;
 *   quartile: number[];
 *   time?: { elapsed: number; remaining?: number };
 * }
 * type Nested = Evolver<Data>; //  => type Nested = {
 * //   id?: ((data: number) => unknown) | undefined;
 * //   quartile?: ((data: number[]) => unknown) | undefined;
 * //   time?:
 * //     | ((data: { elapsed: number; remaining?: number | undefined }) => unknown)
 * //     | {
 * //         elapsed?: ((data: number) => unknown) | undefined;
 * //         remaining?: ((data: number) => unknown) | undefined;
 * //       }
 * //     | undefined;
 * // };
 */
type Evolver<T> = T extends object
  ? T extends IterableContainer
    ? never
    : {
        readonly [K in keyof T]?: K extends symbol
          ? never
          : Evolver<T[K]> | ((data: Required<T>[K]) => unknown);
      }
  : never;

/**
 * Creates return type from the type of arguments of `evolve`.
 */
type Evolved<T, E> = T extends object
  ? {
      -readonly [K in keyof T]: K extends keyof E
        ? E[K] extends (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Functions aren't inferred correctly when using `unknown` for the params.
            ...arg: any
          ) => infer R
          ? R
          : Evolved<T[K], E[K]>
        : Required<T>[K];
    }
  : T;
```
