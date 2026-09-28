/* eslint no-bitwise: 0 */
/**
 * This function returns the quantile in which one would find the given value in
 * the given array. With a sorted array, leveraging binary search, we can find
 * this information in logarithmic time.
 *
 * @param {Array<number>} x input
 * @param {number} value the value for which to find the quantile rank
 * @returns {number} the quantile rank
 * @example
 * quantileRankSorted([1, 2, 3, 4], 3); // => 0.75
 * quantileRankSorted([1, 2, 3, 3, 4], 3); // => 0.7
 * quantileRankSorted([1, 2, 3, 4], 6); // => 1
 * quantileRankSorted([1, 2, 3, 3, 5], 4); // => 0.8
 */
function quantileRankSorted(x, value) {
    throw new Error('not implemented');
}
function lowerBound(x, value) {
    let mid = 0;
    let lo = 0;
    let hi = x.length;
    while (lo < hi) {
        mid = (lo + hi) >>> 1;
        if (value <= x[mid]) {
            hi = mid;
        }
        else {
            lo = -~mid;
        }
    }
    return lo;
}
function upperBound(x, value) {
    let mid = 0;
    let lo = 0;
    let hi = x.length;
    while (lo < hi) {
        mid = (lo + hi) >>> 1;
        if (value >= x[mid]) {
            lo = -~mid;
        }
        else {
            hi = mid;
        }
    }
    return lo;
}
export default quantileRankSorted;
