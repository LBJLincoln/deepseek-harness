/* eslint-disable unicorn/consistent-boolean-name --
 * TODO [>2] -- This rule is on-point! The function's param should communicate
 * more clearly that it takes a boolean value.
 */
import { words } from "./internal/words.js";
const LOWER_CASE_CHARACTER_RE = /[a-z]/u;
const DEFAULT_PRESERVE_CONSECUTIVE_UPPERCASE = true;
export function toCamelCase(dataOrOptions, options) {
    return typeof dataOrOptions === "string"
        ? toCamelCaseImplementation(dataOrOptions, options)
        : (data) => toCamelCaseImplementation(data, dataOrOptions);
}
// Based on the type definition from type-fest.
// @see https://github.com/sindresorhus/type-fest/blob/main/source/camel-case.d.ts#L76-L80
const toCamelCaseImplementation = (data, { preserveConsecutiveUppercase = DEFAULT_PRESERVE_CONSECUTIVE_UPPERCASE, } = {}) => words(LOWER_CASE_CHARACTER_RE.test(data)
    ? data
    : // If the text doesn't have **any** lower case characters we also lower
        // case everything, but if it does we need to maintain them as it
        // affects the word boundaries.
        data.toLowerCase())
    .map((word, index) => `${
// The first word is uncapitalized, the rest are capitalized
index === 0 ? word[0].toLowerCase() : word[0].toUpperCase()}${preserveConsecutiveUppercase ? word.slice(1) : word.slice(1).toLowerCase()}`)
    .join("");
