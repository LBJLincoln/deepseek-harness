# Implement sampleRankCorrelation from simple-statistics

`src/sample_rank_correlation.js` is the JavaScript build of `src/sample_rank_correlation.js` from simple-statistics (https://github.com/simple-statistics/simple-statistics at commit 5ee3e8be581f, ISC licence, whose text is in `LICENSE`). Every export of the module is in place except `sampleRankCorrelation`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * The [rank correlation](https://en.wikipedia.org/wiki/Rank_correlation) is
 * a measure of the strength of monotonic relationship between two arrays
 *
 * Tied values share the average of the ranks they span, so the result
 * depends only on the paired data and not on the order the pairs are given
 * in. When either input has no rank variance the correlation is undefined
 * and the result is `NaN`.
 *
 * @param {Array<number>} x first input
 * @param {Array<number>} y second input
 * @returns {number} sample rank correlation
 * @example
 * sampleRankCorrelation([1, 2, 3, 4, 5], [1, 4, 9, 16, 25]);
 * // => 1
 */
function sampleRankCorrelation(x, y)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/epsilon.js`, `src/mean.js`, `src/sample_correlation.js`, `src/sample_covariance.js`, `src/sample_standard_deviation.js`, `src/sample_variance.js`, `src/sum.js`, `src/sum_nth_power_deviations.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/sample_rank_correlation.js` of simple-statistics (https://github.com/simple-statistics/simple-statistics) at commit `5ee3e8be581ffd4a4b372d5da11cda8c53a0e6bd`, distributed under the ISC licence (Copyright (c) 2014, Tom MacWright); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
