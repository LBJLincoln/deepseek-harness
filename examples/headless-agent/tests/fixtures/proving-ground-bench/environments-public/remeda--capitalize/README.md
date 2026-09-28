# Implement capitalize from remeda

`src/capitalize.js` is the JavaScript build of `packages/remeda/src/capitalize.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `capitalize`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Makes the first character of a string uppercase while leaving the rest
 * unchanged.
 *
 * It uses the built-in [`String.prototype.toUpperCase`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/toUpperCase)
 * for the runtime and the built-in [`Capitalize`](https://www.typescriptlang.org/docs/handbook/2/template-literal-types.html#capitalizestringtype)
 * utility type for typing and thus shares their _[locale inaccuracies](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/toLocaleUpperCase#description)_.
 *
 * For display purposes, prefer using the CSS pseudo-element [`::first-letter`](https://developer.mozilla.org/en-US/docs/Web/CSS/::first-letter) to target
 * just the first letter of the word, and [`text-transform: uppercase`](https://developer.mozilla.org/en-US/docs/Web/CSS/text-transform#uppercase)
 * to capitalize it. This transformation **is** locale-aware.
 *
 * For other case manipulations see: `toUpperCase`, `toLowerCase`,
 * `uncapitalize`, `toCamelCase`, `toKebabCase`, `toSnakeCase`, and
 * `toTitleCase`.
 *
 * @param data - A string.
 * @signature
 *   capitalize(data);
 * @example
 *   capitalize("hello world"); // "Hello world"
 * @dataFirst
 * @category String
 */
export function capitalize(...args: readonly unknown[]): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/lazyDataLastImpl.js`, `src/internal/utilityEvaluators.js`, `src/pipe.js`, `src/purry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/capitalize.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
