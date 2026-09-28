# Implement isPlainObject from es-toolkit

`src/predicate/isPlainObject.js` is the JavaScript build of `src/predicate/isPlainObject.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `isPlainObject`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Checks if a given value is a plain object.
 *
 * @param value - The value to check.
 * @returns True if the value is a plain object, otherwise false.
 *
 * @example
 * ```typescript
 * // ✅👇 True
 *
 * isPlainObject({ });                       // ✅
 * isPlainObject({ key: 'value' });          // ✅
 * isPlainObject({ key: new Date() });       // ✅
 * isPlainObject(new Object());              // ✅
 * isPlainObject(Object.create(null));       // ✅
 * isPlainObject({ nested: { key: true} });  // ✅
 * isPlainObject(new Proxy({}, {}));         // ✅
 * isPlainObject({ [Symbol('tag')]: 'A' });  // ✅
 *
 * // ✅👇 (cross-realms, node context, workers, ...)
 * const runInNewContext = await import('node:vm').then(
 *     (mod) => mod.runInNewContext
 * );
 * isPlainObject(runInNewContext('({})'));   // ✅
 *
 * // ❌👇 False
 *
 * class Test { };
 * isPlainObject(new Test())           // ❌
 * isPlainObject(10);                  // ❌
 * isPlainObject(null);                // ❌
 * isPlainObject('hello');             // ❌
 * isPlainObject([]);                  // ❌
 * isPlainObject(new Date());          // ❌
 * isPlainObject(new Uint8Array([1])); // ❌
 * isPlainObject(Buffer.from('ABC'));  // ❌
 * isPlainObject(Promise.resolve({})); // ❌
 * isPlainObject(Object.create({}));   // ❌
 * isPlainObject(new (class Cls {}));  // ❌
 * isPlainObject(globalThis);          // ❌,
 * ```
 */
export function isPlainObject(value: unknown): value is Record<PropertyKey, any>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/predicate/isPlainObject.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
