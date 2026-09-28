# Implement max from simple-statistics

`src/max.js` is the JavaScript build of `src/max.js` from simple-statistics (https://github.com/simple-statistics/simple-statistics at commit 5ee3e8be581f, ISC licence, whose text is in `LICENSE`). Every export of the module is in place except `max`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * This computes the maximum number in an array.
 *
 * This runs in `O(n)`, linear time, with respect to the length of the array.
 *
 * @param {Array<number>} x sample of one or more data points
 * @returns {number} maximum value
 * @throws {Error} if the length of x is less than one
 * @example
 * max([1, 2, 3, 4]);
 * // => 4
 */
function max(x)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/approx_equal.js`, `src/binomial_distribution.js`, `src/epsilon.js`, `src/extent.js`, `src/extent_sorted.js`, `src/gammaln.js`, `src/max_distribution_cells.js`, `src/max_sorted.js`, `src/median.js`, `src/min.js`, `src/min_sorted.js`, `src/poisson_distribution.js`, `src/quantile.js`, `src/quantile_sorted.js`, `src/quickselect.js`, `src/relative_error.js`, `src/sum.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/max.js` of simple-statistics (https://github.com/simple-statistics/simple-statistics) at commit `5ee3e8be581ffd4a4b372d5da11cda8c53a0e6bd`, distributed under the ISC licence (Copyright (c) 2014, Tom MacWright); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
