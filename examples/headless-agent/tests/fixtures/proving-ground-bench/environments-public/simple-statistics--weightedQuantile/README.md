# Implement weightedQuantile from simple-statistics

`src/weighted_quantile.js` is the JavaScript build of `src/weighted_quantile.js` from simple-statistics (https://github.com/simple-statistics/simple-statistics at commit 5ee3e8be581f, ISC licence, whose text is in `LICENSE`). Every export of the module is in place except `weightedQuantile`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * The weighted quantile is the value whose cumulative weight reaches the
 * requested probability.
 *
 * This implementation sorts value/weight pairs by value, then returns the
 * first value where cumulative weight is greater than or equal to `p` times the
 * total weight. When p is an array, the result is also an array containing the
 * appropriate weighted quantiles in input order.
 *
 * @param {Array<number>} x sample of one or more data points
 * @param {Array<number>} weights non-negative weights for each data point
 * @param {Array<number> | number} p the desired quantile, as a number between 0 and 1
 * @throws {Error} if x is empty, weights is a different length than x, all weights are zero, a weight is negative, or p is outside of the range from 0 to 1
 * @returns {number} weighted quantile
 * @example
 * weightedQuantile([1, 2, 3], [1, 1, 2], 0.5); // => 2
 */
function weightedQuantile(x, weights, p)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/validate_weighted_input.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/weighted_quantile.js` of simple-statistics (https://github.com/simple-statistics/simple-statistics) at commit `5ee3e8be581ffd4a4b372d5da11cda8c53a0e6bd`, distributed under the ISC licence (Copyright (c) 2014, Tom MacWright); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
