# Implement poissonDistribution from simple-statistics

`src/poisson_distribution.js` is the JavaScript build of `src/poisson_distribution.js` from simple-statistics (https://github.com/simple-statistics/simple-statistics at commit 5ee3e8be581f, ISC licence, whose text is in `LICENSE`). Every export of the module is in place except `poissonDistribution`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * The [Poisson Distribution](http://en.wikipedia.org/wiki/Poisson_distribution)
 * is a discrete probability distribution that expresses the probability
 * of a given number of events occurring in a fixed interval of time
 * and/or space if these events occur with a known average rate and
 * independently of the time since the last event.
 *
 * The Poisson Distribution is characterized by the strictly positive
 * mean arrival or occurrence rate, `λ`.
 *
 * Returns `undefined` when the distribution cannot be calculated: when `lambda`
 * is not a strictly positive number, or when it is large enough that the table
 * would run past a million cells.
 *
 * @param {number} lambda location poisson distribution
 * @returns {number[] | undefined} values of poisson distribution at that point
 */
function poissonDistribution(lambda) /*: ?number[] */

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/approx_equal.js`, `src/binomial_distribution.js`, `src/chi_squared_distribution_table.js`, `src/chi_squared_goodness_of_fit.js`, `src/epsilon.js`, `src/gammaln.js`, `src/max.js`, `src/max_distribution_cells.js`, `src/mean.js`, `src/relative_error.js`, `src/sum.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/poisson_distribution.js` of simple-statistics (https://github.com/simple-statistics/simple-statistics) at commit `5ee3e8be581ffd4a4b372d5da11cda8c53a0e6bd`, distributed under the ISC licence (Copyright (c) 2014, Tom MacWright); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
