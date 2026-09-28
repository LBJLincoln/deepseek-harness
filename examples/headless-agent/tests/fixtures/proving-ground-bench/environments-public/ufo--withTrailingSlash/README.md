# Implement withTrailingSlash from ufo

`src/utils.js` is the JavaScript build of `src/utils.ts` from ufo (https://github.com/unjs/ufo at commit f06c800d0c59, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `withTrailingSlash`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Ensures the URL ends with a trailing slash.
 *
 * If second argument is `true`, it will only add the trailing slash if it's not part of the query or fragment with cost of more expensive operation.
 *
 * @example
 *
 * ```js
 * withTrailingSlash("/foo"); // "/foo/"
 *
 * withTrailingSlash("/path?query=true", true); // "/path/?query=true"
 * ```
 *
 * @group utils
 */
export function withTrailingSlash(
  input = "",
  respectQueryAndFragment?: boolean,
): string

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/encoding.js`, `src/parse.js`, `src/punycode.js`, `src/query.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/utils.ts` of ufo (https://github.com/unjs/ufo) at commit `f06c800d0c59f2a4a1b9ba65eb6cb61a84419be6`, distributed under the MIT licence (Copyright (c) Pooya Parsa <pooya@pi0.io>); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/utils.js` erased them.

```ts
export interface HasProtocolOptions {
  acceptRelative?: boolean;
  strict?: boolean;
}

interface CompareURLOptions {
  trailingSlash?: boolean;
  leadingSlash?: boolean;
  encoding?: boolean;
}
```
