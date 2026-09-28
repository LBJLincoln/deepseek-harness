# Implement approxEqual from simple-statistics

`src/approx_equal.js` is the JavaScript build of `src/approx_equal.js` from simple-statistics (https://github.com/simple-statistics/simple-statistics at commit 5ee3e8be581f, ISC licence, whose text is in `LICENSE`). Every export of the module is in place except `approxEqual`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Approximate equality.
 *
 * @param {number} actual The value to be tested.
 * @param {number} expected The reference value.
 * @param {number} [tolerance=epsilon] The acceptable relative difference.
 * @return {boolean} Whether numbers are within tolerance.
 */
function approxEqual(actual, expected, tolerance = epsilon)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/binomial_distribution.js`, `src/epsilon.js`, `src/euclidean_distance.js`, `src/gammaln.js`, `src/make_matrix.js`, `src/max.js`, `src/max_distribution_cells.js`, `src/poisson_distribution.js`, `src/relative_error.js`, `src/silhouette.js`, `src/silhouette_metric.js`, `src/sum.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/approx_equal.js` of simple-statistics (https://github.com/simple-statistics/simple-statistics) at commit `5ee3e8be581ffd4a4b372d5da11cda8c53a0e6bd`, distributed under the ISC licence (Copyright (c) 2014, Tom MacWright); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
