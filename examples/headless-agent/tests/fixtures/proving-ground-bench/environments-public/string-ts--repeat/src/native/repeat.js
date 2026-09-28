/**
 * A strongly-typed version of `String.prototype.repeat`.
 * @param str the string to repeat.
 * @param times the number of times to repeat.
 * @returns the repeated string in both type level and runtime.
 * For counts above 45 the return type falls back to `string`.
 * @example repeat('hello', 3) // 'hellohellohello'
 */
export function repeat(str, times = 0) {
    throw new Error('not implemented');
}
