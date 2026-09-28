# Implement weightedStandardDeviation from simple-statistics

`src/weighted_standard_deviation.js` is the JavaScript build of `src/weighted_standard_deviation.js` from simple-statistics (https://github.com/simple-statistics/simple-statistics at commit 5ee3e8be581f, ISC licence, whose text is in `LICENSE`). Every export of the module is in place except `weightedStandardDeviation`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * The [weighted standard deviation](https://en.wikipedia.org/wiki/Standard_deviation)
 * is the square root of the weighted variance.
 *
 * This is a population weighted standard deviation.
 *
 * @param {Array<number>} x population of one or more data points
 * @param {Array<number>} weights non-negative weights for each data point
 * @throws {Error} if x is empty, weights is a different length than x, all weights are zero, or a weight is negative
 * @returns {number} weighted standard deviation
 * @example
 * weightedStandardDeviation([2, 4, 4, 4, 5, 5, 7, 9], [1, 1, 1, 1, 1, 1, 1, 1]); // => 2
 */
function weightedStandardDeviation(x, weights)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/mean.js`, `src/standard_deviation.js`, `src/sum.js`, `src/sum_nth_power_deviations.js`, `src/validate_weighted_input.js`, `src/variance.js`, `src/weighted_mean.js`, `src/weighted_variance.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/weighted_standard_deviation.js` of simple-statistics (https://github.com/simple-statistics/simple-statistics) at commit `5ee3e8be581ffd4a4b372d5da11cda8c53a0e6bd`, distributed under the ISC licence (Copyright (c) 2014, Tom MacWright); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
