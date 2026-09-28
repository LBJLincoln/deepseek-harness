# Implement pascalCase from change-case

`src/change-case/src/index.js` is the JavaScript build of `packages/change-case/src/index.ts` from change-case (https://github.com/blakeembrey/change-case at commit 9d5505c7e807, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `pascalCase`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Convert a string to pascal case (`FooBar`).
 */
export function pascalCase(input: string, options?: PascalCaseOptions)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/change-case/src/index.ts` of change-case (https://github.com/blakeembrey/change-case) at commit `9d5505c7e807544a18d98052802985069ac190d0`, distributed under the MIT licence (Copyright (c) 2014 Blake Embrey (hello@blakeembrey.com)); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/change-case/src/index.js` erased them.

```ts
/**
 * Supported locale values. Use `false` to ignore locale.
 * Defaults to `undefined`, which uses the host environment.
 */
export type Locale = string[] | string | false | undefined;

/**
 * Options used for converting strings to pascal/camel case.
 */
export interface PascalCaseOptions extends Options {
  mergeAmbiguousCharacters?: boolean;
}

/**
 * Options used for converting strings to any case.
 */
export interface Options {
  locale?: Locale;
  split?: (value: string) => string[];
  /** @deprecated Pass `split: splitSeparateNumbers` instead. */
  separateNumbers?: boolean;
  delimiter?: string;
  prefixCharacters?: string;
  suffixCharacters?: string;
}
```
