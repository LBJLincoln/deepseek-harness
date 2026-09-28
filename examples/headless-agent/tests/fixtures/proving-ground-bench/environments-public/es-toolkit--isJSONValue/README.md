# Implement isJSONValue from es-toolkit

`src/predicate/isJSONValue.js` is the JavaScript build of `src/predicate/isJSONValue.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `isJSONValue`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Checks if a given value is a valid JSON value.
 *
 * A valid JSON value can be:
 * - null
 * - a JSON object (an object with string keys and valid JSON values)
 * - a JSON array (an array of valid JSON values)
 * - a string
 * - a number
 * - a boolean
 *
 * @param value - The value to check.
 * @returns True if the value is a valid JSON value, otherwise false.
 *
 * @example
 * console.log(isJSONValue(null)); // true
 * console.log(isJSONValue({ key: "value" })); // true
 * console.log(isJSONValue([1, 2, 3])); // true
 * console.log(isJSONValue("Hello")); // true
 * console.log(isJSONValue(42)); // true
 * console.log(isJSONValue(true)); // true
 * console.log(isJSONValue(undefined)); // false
 * console.log(isJSONValue(() => {})); // false
 */
export function isJSONValue(value: unknown): value is Record<string, any> | any[] | string | number | boolean | null

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/predicate/isPlainObject.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/predicate/isJSONValue.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
