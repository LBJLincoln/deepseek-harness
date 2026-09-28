# Implement sampleSkewness from simple-statistics

`src/sample_skewness.js` is the JavaScript build of `src/sample_skewness.js` from simple-statistics (https://github.com/simple-statistics/simple-statistics at commit 5ee3e8be581f, ISC licence, whose text is in `LICENSE`). Every export of the module is in place except `sampleSkewness`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

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
function sampleSkewness(x, biased = false)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/mean.js`, `src/sum.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/sample_skewness.js` of simple-statistics (https://github.com/simple-statistics/simple-statistics) at commit `5ee3e8be581ffd4a4b372d5da11cda8c53a0e6bd`, distributed under the ISC licence (Copyright (c) 2014, Tom MacWright); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
