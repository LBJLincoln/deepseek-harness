/* eslint-disable unicorn/consistent-boolean-name --
 * TODO [>2] -- This rule is on-point! The function's param should communicate
 * more clearly that it takes a boolean value.
 */
import { words } from "./internal/words.js";
const LOWER_CASE_CHARACTER_RE = /[a-z]/u;
const DEFAULT_PRESERVE_CONSECUTIVE_UPPERCASE = true;
export function toTitleCase(dataOrOptions, options) {
    throw new Error('not implemented');
}
// Similar to the implementation used in toCamelCase
const toTitleCaseImplementation = (data, { preserveConsecutiveUppercase = DEFAULT_PRESERVE_CONSECUTIVE_UPPERCASE, } = {}) => words(LOWER_CASE_CHARACTER_RE.test(data)
    ? data
    : // If the text doesn't have **any** lowercase characters, we lowercase
        // everything; otherwise we maintain existing case as it affects word
        // boundaries.
        data.toLowerCase())
    .map((word) => `${word[0].toUpperCase()}${preserveConsecutiveUppercase
    ? word.slice(1)
    : word.slice(1).toLowerCase()}`)
    .join(" ");
