import { delimiterCase } from "./delimiter-case.js";
import { pascalCase } from "./pascal-case.js";
/**
 * A strongly typed version of `titleCase` that works in both runtime and type level.
 * @param str the string to convert to title case.
 * @returns the title cased string.
 * @example titleCase('hello world') // 'Hello World'
 */
export function titleCase(str) {
    throw new Error('not implemented');
}
/**
 * @deprecated
 * Use `titleCase` instead.
 * Read more about the deprecation [here](https://github.com/gustavoguichard/string-ts/issues/44).
 */
export const toTitleCase = titleCase;
