# Implement toConstantCaseKeys from es-toolkit

`src/object/toConstantCaseKeys.js` is the JavaScript build of `src/object/toConstantCaseKeys.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `toConstantCaseKeys`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates a new object composed of the properties with keys converted to CONSTANT_CASE.
 *
 * This function takes an object and returns a new object that includes the same properties,
 * but with all keys converted to CONSTANT_CASE format.
 *
 * @template T - The type of object.
 * @param obj - The object to convert keys from.
 * @returns A new object with all keys converted to CONSTANT_CASE.
 *
 * @example
 * // Example with objects
 * const obj = { userId: 1, firstName: 'John' };
 * const result = toConstantCaseKeys(obj);
 * // result will be { USER_ID: 1, FIRST_NAME: 'John' }
 *
 * // Example with arrays of objects
 * const arr = [
 *   { userId: 1, firstName: 'John' },
 *   { userId: 2, firstName: 'Jane' }
 * ];
 * const arrResult = toConstantCaseKeys(arr);
 * // arrResult will be [{ USER_ID: 1, FIRST_NAME: 'John' }, { USER_ID: 2, FIRST_NAME: 'Jane' }]
 *
 * // Example with nested objects
 * const nested = {
 *   userData: {
 *     userId: 1,
 *     userAddress: {
 *       streetName: 'Main St',
 *       zipCode: '12345'
 *     }
 *   }
 * };
 * const nestedResult = toConstantCaseKeys(nested);
 * // nestedResult will be:
 * // {
 * //   USER_DATA: {
 * //     USER_ID: 1,
 * //     USER_ADDRESS: {
 * //       STREET_NAME: 'Main St',
 * //       ZIP_CODE: '12345'
 * //     }
 * //   }
 * // }
 */
export function toConstantCaseKeys<T>(obj: T): ToConstantCaseKeys<T>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/compat/predicate/isArray.js`, `src/compat/predicate/isPlainObject.js`, `src/string/constantCase.js`, `src/string/words.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/object/toConstantCaseKeys.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
