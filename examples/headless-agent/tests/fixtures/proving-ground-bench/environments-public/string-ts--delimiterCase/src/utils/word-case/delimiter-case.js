import { join } from "../../native/join.js";
import { removeApostrophe, } from "../characters/apostrophe.js";
import { words } from "../words.js";
/**
 * A function that transforms a string by splitting it into words and joining them with the specified delimiter.
 * @param str the string to transform.
 * @param delimiter the delimiter to use.
 * @returns the transformed string.
 * @example delimiterCase('hello world', '.') // 'hello.world'
 */
export function delimiterCase(str, delimiter) {
    throw new Error('not implemented');
}
/**
 * @deprecated
 * Use `delimiterCase` instead.
 * Read more about the deprecation [here](https://github.com/gustavoguichard/string-ts/issues/44).
 */
export const toDelimiterCase = delimiterCase;
