# Implement invert from es-toolkit

`src/object/invert.js` is the JavaScript build of `src/object/invert.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `invert`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Inverts the keys and values of an object. The keys of the input object become the values of the output object and vice versa.
 *
 * This function takes an object and creates a new object by inverting its keys and values. If the input object has duplicate values,
 * the key of the last occurrence will be used as the value for the new key in the output object. It effectively creates a reverse mapping
 * of the input object's key-value pairs.
 *
 * @template K - Type of the keys in the input object (string, number, symbol)
 * @template V - Type of the values in the input object (string, number, symbol)
 * @param obj - The input object whose keys and values are to be inverted
 * @returns A new object with keys and values inverted
 *
 * @example
 * invert({ a: 1, b: 2, c: 3 }); // { 1: 'a', 2: 'b', 3: 'c' }
 * invert({ 1: 'a', 2: 'b', 3: 'c' }); // { a: '1', b: '2', c: '3' }
 * invert({ a: 1, 2: 'b', c: 3, 4: 'd' }); // { 1: 'a', b: '2', 3: 'c', d: '4' }
 * invert({ a: Symbol('sym1'), b: Symbol('sym2') }); // { [Symbol('sym1')]: 'a', [Symbol('sym2')]: 'b' }
 */
export function invert<K extends PropertyKey, V extends PropertyKey>(obj: Record<K, V>): Record<V, K>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/object/invert.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
