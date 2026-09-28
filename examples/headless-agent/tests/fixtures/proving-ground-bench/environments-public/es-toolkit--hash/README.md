# Implement hash from es-toolkit

`src/util/hash/browser.js` is the JavaScript build of `src/util/hash/browser.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `hash`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Hashes any value into a stable 43-character string.
 *
 * The value is serialized with `serialize`, so two values with the same
 * structure always hash to the same string regardless of key insertion
 * order, and then digested with SHA-256 and encoded in Base64URL format.
 *
 * The hash is stable across platforms, but it is not designed for security
 * purposes; intentional collisions can be crafted from user input.
 *
 * This entry uses a pure JavaScript SHA-256 implementation; in Node.js,
 * the native `node:crypto` implementation with identical output is used
 * instead.
 *
 * @param value - The value to hash.
 * @returns The Base64URL-encoded SHA-256 hash of the serialized value.
 * @throws {TypeError} If the value contains an object that cannot be serialized.
 *
 * @example
 * hash({ b: 2, a: 1 }) === hash({ a: 1, b: 2 }); // true
 * hash([1, 2, 3]); // "phXuruId5Red4IDejDBSyNqQEThAa6ccOMAyhF99VPQ" (43 characters)
 */
export function hash(value: unknown): string

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/predicate/isArrayBuffer.js`, `src/predicate/isDate.js`, `src/predicate/isError.js`, `src/predicate/isMap.js`, `src/predicate/isPlainObject.js`, `src/predicate/isRegExp.js`, `src/predicate/isSet.js`, `src/predicate/isTypedArray.js`, `src/util/hash/node.js`, `src/util/hash/sha256.js`, `src/util/serialize/compareValues.js`, `src/util/serialize/serialize.js`, `src/util/serialize/serializeBigInt.js`, `src/util/serialize/serializeFunction.js`, `src/util/serialize/serializeNumber.js`, `src/util/serialize/serializeObject.js`, `src/util/serialize/serializePlainObject.js`, `src/util/serialize/serializeString.js`, `src/util/serialize/serializeSymbol.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/util/hash/browser.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
