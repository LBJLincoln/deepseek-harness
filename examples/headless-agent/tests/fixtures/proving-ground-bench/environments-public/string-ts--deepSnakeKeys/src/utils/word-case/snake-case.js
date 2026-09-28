import { toLowerCase } from "../../native/to-lower-case.js";
import { removeApostrophe, } from "../characters/apostrophe.js";
import { delimiterCase } from "./delimiter-case.js";
/**
 * A strongly typed version of `snakeCase` that works in both runtime and type level.
 * @param str the string to convert to snake case.
 * @returns the snake cased string.
 * @example snakeCase('hello world') // 'hello_world'
 */
export function snakeCase(str) {
    return toLowerCase(delimiterCase(removeApostrophe(str), '_'));
}
/**
 * @deprecated
 * Use `snakeCase` instead.
 * Read more about the deprecation [here](https://github.com/gustavoguichard/string-ts/issues/44).
 */
export const toSnakeCase = snakeCase;
