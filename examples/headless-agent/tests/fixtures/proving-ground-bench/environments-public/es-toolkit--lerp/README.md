# Implement lerp from es-toolkit

`src/math/lerp.js` is the JavaScript build of `src/math/lerp.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `lerp`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Returns the number that lies at `fraction` of the way between `start` and `stop`,
 * using linear interpolation.
 *
 * When `fraction` is `0` the result is `start`, when it is `1` the result is `stop`,
 * and when it is `0.5` the result is halfway between them. A `fraction` outside `[0, 1]`
 * is not clamped, so the result continues past `start` or `stop` along the same line.
 *
 * This is the inverse of `inverseLerp`.
 *
 * @param start - The number returned when `fraction` is `0`.
 * @param stop - The number returned when `fraction` is `1`.
 * @param fraction - Where the result lies between `start` and `stop`, usually from `0` to `1`.
 * @returns The number at `fraction` of the way between `start` and `stop`.
 *
 * @example
 * lerp(0, 100, 0.5); // 50
 * lerp(10, 20, 0.25); // 12.5
 * lerp(0, 100, 0); // 0
 * lerp(0, 100, 1); // 100
 * lerp(0, 100, 1.5); // 150
 */
export function lerp(start: number, stop: number, fraction: number): number

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/math/inverseLerp.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/math/lerp.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
