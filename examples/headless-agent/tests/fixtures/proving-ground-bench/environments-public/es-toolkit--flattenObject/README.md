# Implement flattenObject from es-toolkit

`src/object/flattenObject.js` is the JavaScript build of `src/object/flattenObject.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `flattenObject`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Flattens a nested object into a single level object with delimiter-separated keys.
 *
 * @param object - The object to flatten.
 * @param [options.delimiter='.'] - The delimiter to use between nested keys.
 * @param [options.preserveArrays=false] - If true, arrays are kept as values instead of being flattened.
 * @returns The flattened object.
 *
 * @example
 * const nestedObject = {
 *   a: {
 *     b: {
 *       c: 1
 *     }
 *   },
 *   d: [2, 3]
 * };
 *
 * const flattened = flattenObject(nestedObject);
 * console.log(flattened);
 * // Output:
 * // {
 * //   'a.b.c': 1,
 * //   'd.0': 2,
 * //   'd.1': 3
 * // }
 *
 * const preserved = flattenObject(nestedObject, { preserveArrays: true });
 * console.log(preserved);
 * // Output:
 * // {
 * //   'a.b.c': 1,
 * //   'd': [2, 3]
 * // }
 */
export function flattenObject(
  object: object,
  { delimiter = '.', preserveArrays = false }: FlattenObjectOptions = {}
): Record<string, any>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/predicate/isPlainObject.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/object/flattenObject.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/object/flattenObject.js` erased them.

```ts
interface FlattenObjectOptions {
  /**
   * The delimiter to use between nested keys.
   * @default '.'
   */
  delimiter?: string;
  /**
   * If true, arrays are kept as values instead of being flattened.
   * @default false
   */
  preserveArrays?: boolean;
}
```
