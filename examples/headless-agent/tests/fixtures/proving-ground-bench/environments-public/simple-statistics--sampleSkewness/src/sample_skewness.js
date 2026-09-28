import mean from "./mean.js";
/**
 * [Skewness](http://en.wikipedia.org/wiki/Skewness) is
 * a measure of the extent to which a probability distribution of a
 * real-valued random variable "leans" to one side of the mean.
 * The skewness value can be positive or negative, or even undefined.
 *
 * Implementation is based on the adjusted Fisher-Pearson standardized
 * moment coefficient, which is the version found in Excel and several
 * statistical packages including Minitab, SAS and SPSS.
 *
 * Pass `biased` to opt into the biased coefficient instead, which is the
 * population moment ratio `m3 / m2^(3/2)`. That is what R reports and what
 * scipy returns by default; the adjusted coefficient above is scipy's
 * `bias=False`. The two differ by a factor of `sqrt(n * (n - 1)) / (n - 2)`.
 *
 * @since 4.1.0
 * @param {Array<number>} x a sample of 3 or more data points
 * @param {boolean} [biased=false] if true, return the biased coefficient
 * @returns {number} sample skewness
 * @throws {Error} if x has length less than 3
 * @example
 * sampleSkewness([2, 4, 6, 3, 1]); // => 0.590128656384365
 * sampleSkewness([2, 4, 6, 3, 1], true); // => 0.3958703373438167
 */
function sampleSkewness(x, biased = false) {
    throw new Error('not implemented');
}
export default sampleSkewness;
