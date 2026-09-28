# Implement allKeyed from es-toolkit

`src/promise/allKeyed.js` is the JavaScript build of `src/promise/allKeyed.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `allKeyed`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Resolves an object of promises concurrently, returning an object with the same keys and resolved values.
 *
 * Similar to `Promise.all`, but accepts an object of promises instead of an array,
 * preserving the keys in the result. This makes it easy to destructure the resolved values
 * by name instead of relying on positional indices.
 *
 * Based on the [TC39 `Promise.allKeyed` proposal](https://github.com/tc39/proposal-await-dictionary).
 *
 * @template T - A record type where each value is a promise or a value.
 * @param tasks - An object whose values are promises (or plain values) to resolve concurrently.
 * @returns>} A promise that resolves to an object with the same keys and resolved values.
 *
 * @example
 * const { user, posts } = await allKeyed({
 *   user: fetchUser(),
 *   posts: fetchPosts(),
 * });
 *
 * @example
 * // Plain values are also supported
 * const result = await allKeyed({
 *   a: Promise.resolve(1),
 *   b: 2,
 * });
 * // { a: 1, b: 2 }
 */
export async function allKeyed<T extends Record<string, unknown>>(
  tasks: T
): Promise<{ [K in keyof T]: Awaited<T[K]> }>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/promise/allKeyed.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
