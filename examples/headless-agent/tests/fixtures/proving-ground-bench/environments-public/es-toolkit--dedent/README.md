# Implement dedent from es-toolkit

`src/string/dedent.js` is the JavaScript build of `src/string/dedent.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `dedent`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Removes common leading whitespace from each line of a multi-line string.
 *
 * This function can be used as a regular function, as a tagged template literal,
 * or composed with another tag function (TC39 String.dedent proposal).
 * It calculates the common indentation across all non-empty lines and removes it,
 * preserving relative indentation differences between lines.
 * The first and last lines are removed if they are empty or contain only whitespace.
 *
 * When used as a tagged template literal or composed with a tag function, the template
 * must have the same shape `String.dedent` requires: the opening line, right after the
 * opening backtick, and the closing line, right before the closing backtick, may contain
 * only whitespace. Otherwise a `TypeError` is thrown.
 *
 * @param {string | TemplateStringsArray | Function} str - The string, template literal, or tag function to dedent.
 * @param {unknown[]} values - The values to interpolate when used as a tagged template literal.
 * @returns {string | Function} The dedented string, or a dedented tag function when composed.
 * @throws {TypeError} If a template literal has content on its opening or closing line.
 *
 * @example
 * // As a regular function
 * dedent("  hello\n  world"); // "hello\nworld"
 *
 * @example
 * // As a tagged template literal
 * dedent`
 *   hello
 *   world
 * `; // "hello\nworld"
 *
 * @example
 * // Tag composition
 * const html = dedent((strings, ...values) => strings.join(''));
 * html`
 *   <div>Hello</div>
 * `; // "<div>Hello</div>"
 */
export function dedent(
  str: string | TemplateStringsArray | ((strings: TemplateStringsArray, ...values: unknown[]) => unknown),
  ...values: unknown[]
): unknown

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/string/dedent.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
