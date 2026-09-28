# Implement toCamelCase from remeda

`src/toCamelCase.js` is the JavaScript build of `packages/remeda/src/toCamelCase.ts` from remeda (https://github.com/remeda/remeda at commit e8292ddf03f8, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `toCamelCase`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Converts text to **camelCase** by splitting it into words, lowercasing the
 * first word, capitalizing the rest, then joining them back together.
 *
 * Because it uses the built-in case conversion methods, the function shares
 * their _[locale inaccuracies](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/toLocaleLowerCase#description)_
 * too, making it best suited for simple strings like identifiers and internal
 * keys. For linguistic text processing, use [`Intl.Segmenter`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter)
 * with [`granularity: "word"`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter#parameters),
 * [`toLocaleLowerCase`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/toLocaleLowerCase),
 * and [`toLocaleUpperCase`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/toLocaleUpperCase)
 * which are purpose-built to handle nuances in languages and locales.
 *
 * For other case manipulations see: `toLowerCase`, `toUpperCase`, `capitalize`,
 * `uncapitalize`, `toKebabCase`, `toSnakeCase`, and `toTitleCase`.
 *
 * For *PascalCase* use `capitalize(toCamelCase(data))`.
 *
 * @param data - A string.
 * @param options - An _optional_ object with the _optional_ property
 * `preserveConsecutiveUppercase` that can be used to change the way consecutive
 * uppercase characters are handled. Defaults to `true`.
 * @signature
 *   toCamelCase(data);
 *   toCamelCase(data, { preserveConsecutiveUppercase });
 * @example
 *   toCamelCase("hello world"); // "helloWorld"
 *   toCamelCase("__HELLO_WORLD__"); // "helloWorld"
 *   toCamelCase("HasHTML"); // "hasHTML"
 *   toCamelCase("HasHTML", { preserveConsecutiveUppercase: false }); // "hasHtml"
 * @dataFirst
 * @category String
 */
export function toCamelCase(
  dataOrOptions: CamelCaseOptions | string,
  options?: CamelCaseOptions,
): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/internal/utilityEvaluators.js`, `src/internal/words.js`, `src/pipe.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `packages/remeda/src/toCamelCase.ts` of remeda (https://github.com/remeda/remeda) at commit `e8292ddf03f8a334cf8b048983d518f89fe6be97`, distributed under the MIT licence (Copyright (c) 2018 remeda); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/toCamelCase.js` erased them.

```ts
type CamelCaseOptions = {
  readonly preserveConsecutiveUppercase?: boolean;
};

type CamelCaseOptionsWithDefaults<Options extends CamelCaseOptions> =
  OptionalOptionsWithDefaults<
    CamelCaseOptions,
    Options,
    {
      // We use the runtime const for the default type so they stay coupled.
      preserveConsecutiveUppercase: typeof DEFAULT_PRESERVE_CONSECUTIVE_UPPERCASE;
    }
  >;
```
