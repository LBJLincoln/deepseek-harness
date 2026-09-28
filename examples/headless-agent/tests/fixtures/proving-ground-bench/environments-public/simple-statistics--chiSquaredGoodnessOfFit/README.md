# Implement chiSquaredGoodnessOfFit from simple-statistics

`src/chi_squared_goodness_of_fit.js` is the JavaScript build of `src/chi_squared_goodness_of_fit.js` from simple-statistics (https://github.com/simple-statistics/simple-statistics at commit 5ee3e8be581f, ISC licence, whose text is in `LICENSE`). Every export of the module is in place except `chiSquaredGoodnessOfFit`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * The [χ2 (Chi-Squared) Goodness-of-Fit Test](http://en.wikipedia.org/wiki/Goodness_of_fit#Pearson.27s_chi-squared_test)
 * uses a measure of goodness of fit which is the sum of differences between observed and expected outcome frequencies
 * (that is, counts of observations), each squared and divided by the number of observations expected given the
 * hypothesized distribution. The resulting χ2 statistic, `chiSquared`, can be compared to the chi-squared distribution
 * to determine the goodness of fit. In order to determine the degrees of freedom of the chi-squared distribution, one
 * takes the total number of observed frequencies and subtracts the number of estimated parameters. The test statistic
 * follows, approximately, a chi-square distribution with (k − c) degrees of freedom where `k` is the number of non-empty
 * cells and `c` is the number of estimated parameters for the distribution.
 *
 * @param {Array<number>} data
 * @param {Function} distributionType a function that returns a point in a distribution:
 * for instance, binomial, bernoulli, or poisson
 * @param {number} significance
 * @returns {number} chi squared goodness of fit
 * @example
 * // Data from Poisson goodness-of-fit example 10-19 in William W. Hines & Douglas C. Montgomery,
 * // "Probability and Statistics in Engineering and Management Science", Wiley (1980).
 * var data1019 = [
 *     0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
 *     0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
 *     1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
 *     2, 2, 2, 2, 2, 2, 2, 2, 2,
 *     3, 3, 3, 3
 * ];
 * ss.chiSquaredGoodnessOfFit(data1019, ss.poissonDistribution, 0.05); //= false
 */
function chiSquaredGoodnessOfFit(data, distributionType, significance)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/binomial_distribution.js`, `src/chi_squared_distribution_table.js`, `src/epsilon.js`, `src/gammaln.js`, `src/max_distribution_cells.js`, `src/mean.js`, `src/poisson_distribution.js`, `src/sum.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/chi_squared_goodness_of_fit.js` of simple-statistics (https://github.com/simple-statistics/simple-statistics) at commit `5ee3e8be581ffd4a4b372d5da11cda8c53a0e6bd`, distributed under the ISC licence (Copyright (c) 2014, Tom MacWright); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
