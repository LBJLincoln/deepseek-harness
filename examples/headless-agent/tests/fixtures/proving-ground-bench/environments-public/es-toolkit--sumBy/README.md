# Implement sumBy from es-toolkit

`src/math/sumBy.js` is the JavaScript build of `src/math/sumBy.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `sumBy`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Calculates the sum of an array of numbers when applying
 * the `getValue` function to each element.
 *
 * If the array is empty, this function returns `0`.
 *
 * @template T - The type of elements in the array.
 * @param items - An array to calculate the sum.
 * @param getValue - A function that selects a numeric value from each element.
 *   It receives the element and its zero‑based index in the array.
 * @returns The sum of all the numbers as determined by the `getValue` function.
 *
 * @example
 * sumBy([{ a: 1 }, { a: 2 }, { a: 3 }], (x, i) => x.a * i); // Returns: 8
 * sumBy([], () => 1); // Returns: 0
 */
export function sumBy<T>(items: readonly T[], getValue: (element: T, index: number) => number): number

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/math/sumBy.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
