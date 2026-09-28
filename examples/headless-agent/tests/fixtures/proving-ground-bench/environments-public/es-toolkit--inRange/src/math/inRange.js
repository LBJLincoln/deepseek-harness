/**
 * Checks if the value is within a specified range.
 *
 * @param value The value to check.
 * @param minimum The lower bound of the range (inclusive).
 * @param maximum The upper bound of the range (exclusive).
 * @returns `true` if the value is within the specified range, otherwise `false`.
 * @throws {Error} Throws an error if the `minimum` is greater or equal than the `maximum`.
 *
 * @example
 * const result1 = inRange(3, 5); // result1 will be true.
 * const result2 = inRange(1, 2, 5); // result2 will be false.
 * const result3 = inRange(1, 5, 2); // If the minimum is greater or equal than the maximum, an error is thrown.
 */
export function inRange(value, minimum, maximum) {
    throw new Error('not implemented');
}
