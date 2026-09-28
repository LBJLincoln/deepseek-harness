# Implement compact from es-toolkit

`src/array/compact.js` is the JavaScript build of `src/array/compact.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `compact`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Removes falsey values (false, null, 0, -0, 0n, '', undefined, NaN) from an array.
 *
 * @template T - The type of elements in the array.
 * @param arr - The input array to remove falsey values.
 * @returns A new array with all falsey values removed.
 *
 * @example
 * compact([0, -0, 0n, 1, false, 2, '', 3, null, undefined, 4, NaN, 5]);
 * Returns: [1, 2, 3, 4, 5]
 */
export function compact<T>(arr: readonly T[]): Array<NotFalsey<T>>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/array/compact.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/array/compact.js` erased them.

```ts
type NotFalsey<T> = Exclude<T, false | null | 0 | 0n | '' | undefined>;
```
