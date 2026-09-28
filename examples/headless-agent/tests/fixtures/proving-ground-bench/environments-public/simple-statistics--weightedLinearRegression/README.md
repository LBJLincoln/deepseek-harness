# Implement weightedLinearRegression from simple-statistics

`src/weighted_linear_regression.js` is the JavaScript build of `src/weighted_linear_regression.js` from simple-statistics (https://github.com/simple-statistics/simple-statistics at commit 5ee3e8be581f, ISC licence, whose text is in `LICENSE`). Every export of the module is in place except `weightedLinearRegression`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

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
function weightedLinearRegression(data, weights)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/linear_regression.js`, `src/linear_regression_line.js`, `src/validate_weighted_input.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/weighted_linear_regression.js` of simple-statistics (https://github.com/simple-statistics/simple-statistics) at commit `5ee3e8be581ffd4a4b372d5da11cda8c53a0e6bd`, distributed under the ISC licence (Copyright (c) 2014, Tom MacWright); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
