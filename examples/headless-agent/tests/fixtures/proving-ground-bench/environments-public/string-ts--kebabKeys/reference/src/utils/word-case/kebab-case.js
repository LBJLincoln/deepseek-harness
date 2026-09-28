import { toLowerCase } from "../../native/to-lower-case.js";
import { removeApostrophe, } from "../characters/apostrophe.js";
import { delimiterCase } from "./delimiter-case.js";
/**
 * A strongly typed version of `kebabCase` that works in both runtime and type level.
 * @param str the string to convert to kebab case.
 * @returns the kebab cased string.
 * @example kebabCase('hello world') // 'hello-world'
 */
export function kebabCase(str) {
    return toLowerCase(delimiterCase(removeApostrophe(str), '-'));
}
/**
 * @deprecated
 * Use `kebabCase` instead.
 * Read more about the deprecation [here](https://github.com/gustavoguichard/string-ts/issues/44).
 */
export const toKebabCase = kebabCase;
