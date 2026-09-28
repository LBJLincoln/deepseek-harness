# Implement normalDistribution from simple-statistics

`src/normal_distribution.js` is the JavaScript build of `src/normal_distribution.js` from simple-statistics (https://github.com/simple-statistics/simple-statistics at commit 5ee3e8be581f, ISC licence, whose text is in `LICENSE`). Every export of the module is in place except `normalDistribution`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * **[Normal distribution](https://en.wikipedia.org/wiki/Normal_distribution)**
 *
 * Returns either the probability density or the cumulative probability of a
 * normal distribution with the given mean and standard deviation, evaluated
 * at x. It is the equivalent of the NORM.DIST function found in spreadsheet
 * software.
 *
 * The cumulative form is computed with `errorFunction`, so it is more precise
 * than converting x to a z-score and looking it up in the four-decimal
 * `standardNormalTable` used by `cumulativeStdNormalProbability`.
 *
 * @param {number} x the value for which you want the distribution
 * @param {number} mean the mean of the distribution
 * @param {number} standardDeviation the standard deviation of the distribution
 * @param {boolean} [cumulative=false] if true, return the cumulative
 * distribution function; if false, return the probability density function
 * @returns {number} the probability density at x, or the probability of a
 * value at most x
 * @throws {Error} if standardDeviation is not greater than zero
 * @example
 * normalDistribution(42, 40, 1.5, true).toFixed(4); // => '0.9088'
 * normalDistribution(42, 40, 1.5, false).toFixed(4); // => '0.1093'
 */
function normalDistribution(x, mean, standardDeviation, cumulative = false)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/cumulative_std_normal_probability.js`, `src/error_function.js`, `src/standard_normal_table.js`, `src/z_score.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/normal_distribution.js` of simple-statistics (https://github.com/simple-statistics/simple-statistics) at commit `5ee3e8be581ffd4a4b372d5da11cda8c53a0e6bd`, distributed under the ISC licence (Copyright (c) 2014, Tom MacWright); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
