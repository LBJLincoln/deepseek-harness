/**
 * A strongly-typed version of `String.prototype.padStart`.
 * @param str the string to pad.
 * @param length the length to pad.
 * @param pad the string to pad with.
 * @returns the padded string in both type level and runtime.
 * When the required padding exceeds 45 characters the return type
 * becomes a template literal (e.g. `` `${string}hello` ``) instead of
 * an exact literal.
 * @example padStart('hello', 10, '=') // '=====hello'
 */
export function padStart(str, length = 0, pad = ' ') {
    throw new Error('not implemented');
}
