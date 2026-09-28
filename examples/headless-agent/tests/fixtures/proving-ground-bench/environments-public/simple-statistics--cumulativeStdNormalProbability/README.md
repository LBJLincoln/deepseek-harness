# Implement cumulativeStdNormalProbability from simple-statistics

`src/cumulative_std_normal_probability.js` is the JavaScript build of `src/cumulative_std_normal_probability.js` from simple-statistics (https://github.com/simple-statistics/simple-statistics at commit 5ee3e8be581f, ISC licence, whose text is in `LICENSE`). Every export of the module is in place except `cumulativeStdNormalProbability`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * **[Cumulative Standard Normal Probability](http://en.wikipedia.org/wiki/Standard_normal_table)**
 *
 * Since probability tables cannot be
 * printed for every normal distribution, as there are an infinite variety
 * of normal distributions, it is common practice to convert a normal to a
 * standard normal and then use the standard normal table to find probabilities.
 *
 * You can use `.5 + .5 * errorFunction(x / Math.sqrt(2))` to calculate the probability
 * instead of looking it up in a table.
 *
 * @param {number} z
 * @returns {number} cumulative standard normal probability
 */
function cumulativeStdNormalProbability(z)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/cumulative_std_logistic_probability.js`, `src/epsilon.js`, `src/error_function.js`, `src/inverse_error_function.js`, `src/normal_distribution.js`, `src/probit.js`, `src/standard_normal_table.js`, `src/z_score.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/cumulative_std_normal_probability.js` of simple-statistics (https://github.com/simple-statistics/simple-statistics) at commit `5ee3e8be581ffd4a4b372d5da11cda8c53a0e6bd`, distributed under the ISC licence (Copyright (c) 2014, Tom MacWright); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
