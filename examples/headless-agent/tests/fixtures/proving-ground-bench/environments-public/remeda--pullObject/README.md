# Implement pullObject from remeda

`src/pullObject.js` is the JavaScript build of `packages/remeda/src/pullObject.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `pullObject`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates an object that maps the result of `valueExtractor` with a key
 * resulting from running `keyExtractor` on each item in `data`. Duplicate keys
 * are overwritten, guaranteeing that the extractor functions are run on each
 * item in `data`.
 *
 * There are several other functions that could be used to build an object from
 * an array:
 * * `fromKeys` - Builds an object from an array of *keys* and a mapper for values.
 * * `indexBy` - Builds an object from an array of *values* and a mapper for keys.
 * * `fromEntries` - Builds an object from an array of key-value pairs.
 * Refer to the docs for more details.
 *
 * @param data - The items used to pull/extract the keys and values from.
 * @param keyExtractor - Computes the key for item.
 * @param valueExtractor - Computes the value for the item.
 * @signature
 *   pullObject(data, keyExtractor, valueExtractor);
 * @example
 *   pullObject(
 *     [
 *       { name: "john", email: "john@remedajs.com" },
 *       { name: "jane", email: "jane@remedajs.com" }
 *     ],
 *     prop("name"),
 *     prop("email"),
 *   ); // => { john: "john@remedajs.com", jane: "jane@remedajs.com" }
 * @dataFirst
 * @category Object
 */
export function pullObject(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/add.js`, `src/constant.js`, `src/identity.js`, `src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/pipe.js`, `src/prop.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/pullObject.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
