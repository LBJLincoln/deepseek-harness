import validateWeightedInput from "./validate_weighted_input.js";
/**
 * [Weighted least squares](https://en.wikipedia.org/wiki/Weighted_least_squares)
 * fits a line through a set of coordinates in which some observations count
 * for more than others, which is what R's `lm()` does when given a `weights`
 * argument. `linearRegression` is the special case where every weight is
 * equal.
 *
 * A weight of zero drops its observation from the fit. Weights are relative,
 * so scaling all of them by the same factor leaves the line unchanged.
 *
 * @param {Array<Array<number>>} data an array of two-element arrays,
 * like `[[0, 1], [2, 3]]`
 * @param {Array<number>} weights weight for each coordinate
 * @returns {Object} object containing slope and intersect of regression line
 * @throws {Error} if data is empty, weights is a different length than data,
 * all weights are zero, or a weight is negative
 * @example
 * weightedLinearRegression([[0, 0], [1, 1], [2, 2]], [1, 1, 1]); // => { m: 1, b: 0 }
 */
function weightedLinearRegression(data, weights) {
    throw new Error('not implemented');
}
export default weightedLinearRegression;
