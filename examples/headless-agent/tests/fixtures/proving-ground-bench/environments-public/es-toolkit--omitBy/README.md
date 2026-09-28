# Implement omitBy from es-toolkit

`src/object/omitBy.js` is the JavaScript build of `src/object/omitBy.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `omitBy`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates a new object composed of the properties that do not satisfy the predicate function.
 *
 * This function takes an object and a predicate function, and returns a new object that
 * includes only the properties for which the predicate function returns false.
 *
 * @template T - The type of object.
 * @param obj - The object to omit properties from.
 * @param shouldOmit - A predicate function that determines
 * whether a property should be omitted. It takes the property's key and value as arguments and returns `true`
 * if the property should be omitted, and `false` otherwise. Numeric keys are passed as strings.
 * @returns A new object with the properties that do not satisfy the predicate function.
 *
 * @example
 * const obj = { a: 1, b: 'omit', c: 3 };
 * const shouldOmit = (value) => typeof value === 'string';
 * const result = omitBy(obj, shouldOmit);
 * // result will be { a: 1, c: 3 }
 */
export function omitBy<T extends Record<string, any>>(
  obj: T,
  shouldOmit: (value: T[keyof T], key: ObjectKeys<T>) => boolean
): Partial<T>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/object/omitBy.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
