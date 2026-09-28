# Implement weightedMean from simple-statistics

`src/weighted_mean.js` is the JavaScript build of `src/weighted_mean.js` from simple-statistics (https://github.com/simple-statistics/simple-statistics at commit 5ee3e8be581f, ISC licence, whose text is in `LICENSE`). Every export of the module is in place except `weightedMean`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

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
function weightedMean(x, weights)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/mean.js`, `src/sum.js`, `src/validate_weighted_input.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/weighted_mean.js` of simple-statistics (https://github.com/simple-statistics/simple-statistics) at commit `5ee3e8be581ffd4a4b372d5da11cda8c53a0e6bd`, distributed under the ISC licence (Copyright (c) 2014, Tom MacWright); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
