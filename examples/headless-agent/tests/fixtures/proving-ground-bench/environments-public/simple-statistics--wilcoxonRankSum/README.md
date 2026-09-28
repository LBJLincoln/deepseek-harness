# Implement wilcoxonRankSum from simple-statistics

`src/wilcoxon_rank_sum.js` is the JavaScript build of `src/wilcoxon_rank_sum.js` from simple-statistics (https://github.com/simple-statistics/simple-statistics at commit 5ee3e8be581f, ISC licence, whose text is in `LICENSE`). Every export of the module is in place except `wilcoxonRankSum`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * This function calculates the Wilcoxon rank sum statistic for the first sample
 * with respect to the second. The Wilcoxon rank sum test is a non-parametric
 * alternative to the t-test which is equivalent to the
 * [Mann-Whitney U test](https://en.wikipedia.org/wiki/Mann%E2%80%93Whitney_U_test).
 * The statistic is calculated by pooling all the observations together, ranking them,
 * and then summing the ranks associated with one of the samples. If this rank sum is
 * sufficiently large or small we reject the hypothesis that the two samples come
 * from the same distribution in favor of the alternative that one is shifted with
 * respect to the other.
 *
 * @param {Array<number>} sampleX a sample as an array of numbers
 * @param {Array<number>} sampleY a sample as an array of numbers
 * @returns {number} rank sum for sampleX
 *
 * @example
 * wilcoxonRankSum([1, 4, 8], [9, 12, 15]); // => 6
 */
function wilcoxonRankSum(sampleX, sampleY)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/wilcoxon_rank_sum.js` of simple-statistics (https://github.com/simple-statistics/simple-statistics) at commit `5ee3e8be581ffd4a4b372d5da11cda8c53a0e6bd`, distributed under the ISC licence (Copyright (c) 2014, Tom MacWright); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
