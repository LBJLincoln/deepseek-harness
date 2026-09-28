# Implement inverseLerp from es-toolkit

`src/math/inverseLerp.js` is the JavaScript build of `src/math/inverseLerp.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `inverseLerp`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Returns where `value` lies between `start` and `stop`, as a fraction from `0` to `1`.
 *
 * When `value` equals `start` the result is `0`, when it equals `stop` the result is `1`,
 * and when it is halfway between them the result is `0.5`. A `value` outside `[start, stop]`
 * is not clamped, so the result can be less than `0` or greater than `1`.
 *
 * When `start` and `stop` are the same number there is no position to measure, so `0` is returned.
 *
 * This is the inverse of `lerp`, and is also known as normalizing a number to a range.
 *
 * @param start - The number that maps to `0`.
 * @param stop - The number that maps to `1`.
 * @param value - The number to locate between `start` and `stop`.
 * @returns Where `value` lies between `start` and `stop`, as a fraction from `0` to `1`.
 *
 * @example
 * inverseLerp(0, 100, 50); // 0.5
 * inverseLerp(10, 20, 12.5); // 0.25
 * inverseLerp(0, 100, 0); // 0
 * inverseLerp(0, 100, 100); // 1
 * inverseLerp(0, 100, 150); // 1.5
 * inverseLerp(5, 5, 5); // 0
 */
export function inverseLerp(start: number, stop: number, value: number): number

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/math/lerp.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/math/inverseLerp.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
