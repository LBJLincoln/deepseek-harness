# Implement serialize from es-toolkit

`src/util/serialize/serialize.js` is the JavaScript build of `src/util/serialize/serialize.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `serialize`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Serializes any value into a stable string.
 *
 * Two values with the same structure always serialize to the same string,
 * regardless of key insertion order, so the output is suitable for hashing,
 * cache keys, and change detection. It is not designed for security purposes;
 * intentional collisions can be crafted from user input.
 *
 * Plain object keys, `Map` keys, and `Set` values are sorted, so the output
 * does not depend on insertion order. String keys are always quoted, so a
 * string key never collides with a key of another type. Circular references
 * are serialized as `#ref{n}` back-references, where `n` is the order in
 * which the object was first visited.
 *
 * Objects that cannot be serialized meaningfully, such as `Promise`, `WeakMap`,
 * or `Blob`, throw a `TypeError`.
 *
 * @param value - The value to serialize.
 * @returns The serialized string.
 * @throws {TypeError} If the value contains an object that cannot be serialized.
 *
 * @example
 * serialize({ b: 2, a: 1 }); // "{'a':1,'b':2}"
 * serialize([1, 2n, 'a', { k: 1 }]); // "[1,2n,'a',{'k':1}]"
 * serialize(new Set([3, 1, 2])); // "Set[1,2,3]"
 * serialize(new Date(0)); // "Date('1970-01-01T00:00:00.000Z')"
 *
 * const obj = {};
 * obj.self = obj;
 * serialize(obj); // "{'self':#ref0}"
 */
export function serialize(value: unknown): string

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/predicate/isArrayBuffer.js`, `src/predicate/isDate.js`, `src/predicate/isError.js`, `src/predicate/isMap.js`, `src/predicate/isPlainObject.js`, `src/predicate/isRegExp.js`, `src/predicate/isSet.js`, `src/predicate/isTypedArray.js`, `src/util/hash/node.js`, `src/util/serialize/compareValues.js`, `src/util/serialize/serializeBigInt.js`, `src/util/serialize/serializeFunction.js`, `src/util/serialize/serializeNumber.js`, `src/util/serialize/serializeObject.js`, `src/util/serialize/serializePlainObject.js`, `src/util/serialize/serializeString.js`, `src/util/serialize/serializeSymbol.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/util/serialize/serialize.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
