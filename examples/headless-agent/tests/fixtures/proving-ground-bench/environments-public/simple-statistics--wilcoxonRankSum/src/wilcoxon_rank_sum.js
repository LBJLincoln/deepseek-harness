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
function wilcoxonRankSum(sampleX, sampleY) {
    throw new Error('not implemented');
}
export default wilcoxonRankSum;
