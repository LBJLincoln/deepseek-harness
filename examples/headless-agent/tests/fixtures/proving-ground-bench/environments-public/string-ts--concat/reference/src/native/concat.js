import { join } from "./join.js";
/**
 * A strongly-typed version of `String.prototype.concat`.
 * @param strings the tuple of strings to concatenate.
 * @returns the concatenated string in both type level and runtime.
 * @example concat('a', 'bc', 'def') // 'abcdef'
 */
export function concat(...strings) {
    return join(strings);
}
