# Implement findKey from es-toolkit

`src/object/findKey.js` is the JavaScript build of `src/object/findKey.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `findKey`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Finds the key of the first element in the object that satisfies the provided testing function.
 *
 * @param obj - The object to search.
 * @param predicate - The function to execute on each value in the object. It takes three arguments:
 *   - value: The current value being processed in the object.
 *   - key: The key of the current value being processed in the object.
 *   - obj: The object that findKey was called upon.
 * @returns The key of the first element in the object that passes the test, or undefined if no element passes.
 *
 * @example
 * const users = {
 *   'barney':  { 'age': 36, 'active': true },
 *   'fred':    { 'age': 40, 'active': false },
 *   'pebbles': { 'age': 1,  'active': true }
 * };
 * findKey(users, function(o) { return o.age < 40; }); => 'barney'
 */
export function findKey<T extends Record<any, any>>(
  obj: T,
  predicate: (value: T[keyof T], key: ObjectKeys<T>, obj: T) => boolean
): ObjectKeys<T> | undefined

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/object/findKey.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
