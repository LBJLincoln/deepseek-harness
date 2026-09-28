import { pascalCaseAll } from "../../internal/internals.js";
import { join } from "../../native/join.js";
import { removeApostrophe, } from "../characters/apostrophe.js";
import { words } from "../words.js";
/**
 * A strongly typed version of `pascalCase` that works in both runtime and type level.
 * @param str the string to convert to pascal case.
 * @returns the pascal cased string.
 * @example pascalCase('hello world') // 'HelloWorld'
 */
export function pascalCase(str) {
    return join(pascalCaseAll(words(removeApostrophe(str))));
}
/**
 * @deprecated
 * Use `pascalCase` instead.
 * Read more about the deprecation [here](https://github.com/gustavoguichard/string-ts/issues/44).
 */
export const toPascalCase = pascalCase;
