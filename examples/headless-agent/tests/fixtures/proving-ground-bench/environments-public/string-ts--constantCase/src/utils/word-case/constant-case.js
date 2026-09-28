import { toUpperCase } from "../../native/to-upper-case.js";
import { removeApostrophe, } from "../characters/apostrophe.js";
import { delimiterCase } from "./delimiter-case.js";
/**
 * A strongly typed version of `constantCase` that works in both runtime and type level.
 * @param str the string to convert to constant case.
 * @returns the constant cased string.
 * @example constantCase('hello world') // 'HELLO_WORLD'
 */
export function constantCase(str) {
    throw new Error('not implemented');
}
/**
 * @deprecated
 * Use `constantCase` instead.
 * Read more about the deprecation [here](https://github.com/gustavoguichard/string-ts/issues/44).
 */
export const toConstantCase = constantCase;
