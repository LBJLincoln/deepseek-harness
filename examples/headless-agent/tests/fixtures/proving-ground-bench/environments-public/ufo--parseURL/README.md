# Implement parseURL from ufo

`src/parse.js` is the JavaScript build of `src/parse.ts` from ufo (https://github.com/unjs/ufo at commit f06c800d0c59, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `parseURL`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Takes a URL string and returns an object with the URL's `protocol`, `auth`, `host`, `pathname`, `search`, and `hash`.
 *
 * @example
 *
 * ```js
 * parseURL("http://foo.com/foo?test=123#token");
 * // { protocol: 'http:', auth: '', host: 'foo.com', pathname: '/foo', search: '?test=123', hash: '#token' }
 *
 * parseURL("foo.com/foo?test=123#token");
 * // { pathname: 'foo.com/foo', search: '?test=123', hash: '#token' }
 *
 * parseURL("foo.com/foo?test=123#token", "https://");
 * // { protocol: 'https:', auth: '', host: 'foo.com', pathname: '/foo', search: '?test=123', hash: '#token' }
 * ```
 *
 * @group parsing_utils
 *
 * @param [input] - The URL to parse.
 * @param [defaultProto] - The default protocol to use if the input doesn't have one.
 * @returns A parsed URL object.
 */
export function parseURL(input = "", defaultProto?: string): ParsedURL

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/encoding.js`, `src/punycode.js`, `src/query.js`, `src/utils.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/parse.ts` of ufo (https://github.com/unjs/ufo) at commit `f06c800d0c59f2a4a1b9ba65eb6cb61a84419be6`, distributed under the MIT licence (Copyright (c) Pooya Parsa <pooya@pi0.io>); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/parse.js` erased them.

```ts
export interface ParsedURL {
  protocol?: string;
  host?: string;
  auth?: string;
  href?: string;
  pathname: string;
  hash: string;
  search: string;
  [protocolRelative]?: boolean;
}

export type ParsedPath = Pick<ParsedURL, "pathname" | "hash" | "search">;

export interface ParsedAuth {
  username: string;
  password: string;
}

export interface ParsedHost {
  hostname: string;
  port: string;
}
```
