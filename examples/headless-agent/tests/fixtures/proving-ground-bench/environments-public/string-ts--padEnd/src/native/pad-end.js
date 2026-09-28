/**
 * A strongly-typed version of `String.prototype.padEnd`.
 * @param str the string to pad.
 * @param length the length to pad.
 * @param pad the string to pad with.
 * @returns the padded string in both type level and runtime.
 * When the required padding exceeds 45 characters the return type
 * becomes a template literal (e.g. `` `hello${string}` ``) instead of
 * an exact literal.
 * @example padEnd('hello', 10, '=') // 'hello====='
 */
export function padEnd(str, length = 0, pad = ' ') {
    throw new Error('not implemented');
}
