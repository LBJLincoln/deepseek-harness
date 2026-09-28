/**
 * A strongly-typed version of `String.prototype.trimEnd`.
 * @param str the string to trim.
 * @returns the trimmed string in both type level and runtime.
 * @example trimEnd(' hello world ') // ' hello world'
 */
export function trimEnd(str) {
    return str.trimEnd();
}
