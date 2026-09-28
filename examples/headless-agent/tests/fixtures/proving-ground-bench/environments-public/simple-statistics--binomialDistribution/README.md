# Implement binomialDistribution from simple-statistics

`src/binomial_distribution.js` is the JavaScript build of `src/binomial_distribution.js` from simple-statistics (https://github.com/simple-statistics/simple-statistics at commit 5ee3e8be581f, ISC licence, whose text is in `LICENSE`). Every export of the module is in place except `binomialDistribution`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * The [Binomial Distribution](http://en.wikipedia.org/wiki/Binomial_distribution) is the discrete probability
 * distribution of the number of successes in a sequence of n independent yes/no experiments, each of which yields
 * success with probability `probability`. Such a success/failure experiment is also called a Bernoulli experiment or
 * Bernoulli trial; when trials = 1, the Binomial Distribution is a Bernoulli Distribution.
 *
 * Returns `undefined` when the distribution cannot be calculated: either
 * argument is outside its domain or is not a number, or when `trials` is large
 * enough that the table would run past a million cells.
 *
 * @param {number} trials number of trials to simulate
 * @param {number} probability
 * @returns {number[] | undefined} output
 */
function binomialDistribution(trials, probability) /*: ?number[] */

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/approx_equal.js`, `src/chi_squared_distribution_table.js`, `src/chi_squared_goodness_of_fit.js`, `src/epsilon.js`, `src/gammaln.js`, `src/max.js`, `src/max_distribution_cells.js`, `src/mean.js`, `src/poisson_distribution.js`, `src/relative_error.js`, `src/sum.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/binomial_distribution.js` of simple-statistics (https://github.com/simple-statistics/simple-statistics) at commit `5ee3e8be581ffd4a4b372d5da11cda8c53a0e6bd`, distributed under the ISC licence (Copyright (c) 2014, Tom MacWright); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
