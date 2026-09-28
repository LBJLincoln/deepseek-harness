import validateWeightedInput from "./validate_weighted_input.js";
/**
 * The [weighted mean](https://en.wikipedia.org/wiki/Weighted_arithmetic_mean),
 * _also known as weighted average_, is the sum of each value multiplied by its
 * weight, divided by the total weight.
 *
 * The weighted values are accumulated with the same
 * [Kahan-Babuska](https://pdfs.semanticscholar.org/1760/7d467cda1d0277ad272deb2113533131dc09.pdf)
 * correction that {@link sum} uses, so that terms which cancel do not lose
 * precision. The correction is applied in a single pass, without building an
 * intermediate array.
 *
 * This runs in `O(n)`, linear time, with respect to the length of the array.
 *
 * @param {Array<number>} x sample of one or more data points
 * @param {Array<number>} weights non-negative weights for each data point
 * @throws {Error} if x is empty, weights is a different length than x, all weights are zero, or a weight is negative
 * @returns {number} weighted mean
 * @example
 * weightedMean([80, 90, 100], [1, 1, 2]); // => 92.5
 */
function weightedMean(x, weights) {
    throw new Error('not implemented');
}
export default weightedMean;
