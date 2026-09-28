# Implement serializeFunction from es-toolkit

`src/util/serialize/serializeFunction.js` is the JavaScript build of `src/util/serialize/serializeFunction.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `serializeFunction`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Serializes a function into a string of the form `name:source`.
 *
 * Native functions have no meaningful source, so they are serialized as
 * `name:[native]`. For other functions, newlines and their surrounding
 * whitespace are collapsed so that formatting differences do not change
 * the output.
 *
 * @param value - The function to serialize.
 * @returns The serialized string.
 *
 * @example
 * function sum(a, b) {
 *   return a + b;
 * }
 * serializeFunction(sum); // "sum:function sum(a, b) {return a + b;}"
 * serializeFunction(Math.max); // "max:[native]"
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function serializeFunction(value: Function): string

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/util/serialize/serializeFunction.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
