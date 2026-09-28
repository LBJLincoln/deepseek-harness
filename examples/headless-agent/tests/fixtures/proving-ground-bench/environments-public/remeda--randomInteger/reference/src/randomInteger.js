/**
 * Generate a random integer between `from` and `to` (inclusive).
 *
 * !Important: This function uses [`Math.random()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/random) under-the-hood, which has two major limitations:
 * 1. It generates 2^52 possible values, so the bigger the range, the less
 * uniform the distribution of values would be, and at ranges larger than that
 * some values would never come up.
 * 2. It is not cryptographically secure and should not be used for security
 * scenarios.
 *
 * @param from - The minimum value.
 * @param to - The maximum value.
 * @returns The random integer.
 * @signature
 *   randomInteger(from, to)
 * @example
 *   randomInteger(1, 10) // => 5
 *   randomInteger(1.5, 2.6) // => 2
 * @dataFirst
 * @category Number
 */
export function randomInteger(from, to) {
    const fromCeiled = Math.ceil(from);
    const toFloored = Math.floor(to);
    if (toFloored < fromCeiled) {
        throw new RangeError(`randomInteger: The range [${from.toString()},${to.toString()}] contains no integer`);
    }
    return Math.floor(Math.random() * (toFloored - fromCeiled + 1) + fromCeiled);
}
