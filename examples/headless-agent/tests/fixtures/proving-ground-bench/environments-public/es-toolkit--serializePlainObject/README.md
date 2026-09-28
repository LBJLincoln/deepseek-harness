# Implement serializePlainObject from es-toolkit

`src/util/serialize/serializePlainObject.js` is the JavaScript build of `src/util/serialize/serializePlainObject.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `serializePlainObject`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Serializes the own enumerable string-keyed properties of an object
 * into a `{'key':value}` string.
 *
 * Keys are sorted by code unit so that the output does not depend on
 * property insertion order, and always quoted so that a key containing
 * `:` or `,` cannot be confused with the surrounding structure. Symbol
 * keys and non-enumerable properties are ignored.
 *
 * @param object - The object to serialize.
 * @param refs - The circular reference context shared with the surrounding serialization.
 * @returns The serialized string.
 *
 * @example
 * serializePlainObject({ b: 2, a: 1 }, new Map()); // "{'a':1,'b':2}"
 */
export function serializePlainObject(object: object, refs: Map<object, string>): string

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/predicate/isArrayBuffer.js`, `src/predicate/isDate.js`, `src/predicate/isError.js`, `src/predicate/isMap.js`, `src/predicate/isPlainObject.js`, `src/predicate/isRegExp.js`, `src/predicate/isSet.js`, `src/predicate/isTypedArray.js`, `src/util/serialize/compareValues.js`, `src/util/serialize/serialize.js`, `src/util/serialize/serializeBigInt.js`, `src/util/serialize/serializeFunction.js`, `src/util/serialize/serializeNumber.js`, `src/util/serialize/serializeObject.js`, `src/util/serialize/serializeString.js`, `src/util/serialize/serializeSymbol.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/util/serialize/serializePlainObject.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
