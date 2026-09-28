# Implement reverse from string-ts

`src/utils/reverse.js` is the JavaScript build of `src/utils/reverse.ts` from string-ts (https://github.com/gustavoguichard/string-ts at commit 7850efd6baba, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `reverse`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * A strongly-typed function to reverse a string.
 * @param str the string to reverse.
 * @returns the reversed string in both type level and runtime.
 * @example reverse('hello world') // 'dlrow olleh'
 */
function reverse<T extends string>(str: T)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/utils/reverse.ts` of string-ts (https://github.com/gustavoguichard/string-ts) at commit `7850efd6baba551d60e4b85a2e4a8ed075167bb5`, distributed under the MIT licence (Copyright (c) 2023 Gustavo Guichard); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/utils/reverse.js` erased them.

```ts
/**
 * Reverses a string.
 * - `T` The string to reverse.
 */
type Reverse<
  T extends string,
  _acc extends string = '',
> = T extends `${infer Head}${infer Tail}`
  ? Reverse<Tail, `${Head}${_acc}`>
  : _acc extends ''
    ? T
    : `${T}${_acc}`
```
