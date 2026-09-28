import { removeApostrophe, } from "../characters/apostrophe.js";
import { pascalCase } from "./pascal-case.js";
import { uncapitalize } from "./uncapitalize.js";
/**
 * A strongly typed version of `camelCase` that works in both runtime and type level.
 * @param str the string to convert to camel case.
 * @returns the camel cased string.
 * @example camelCase('hello world') // 'helloWorld'
 */
export function camelCase(str) {
    throw new Error('not implemented');
}
/**
 * @deprecated
 * Use `camelCase` instead.
 * Read more about the deprecation [here](https://github.com/gustavoguichard/string-ts/issues/44).
 */
export const toCamelCase = camelCase;
