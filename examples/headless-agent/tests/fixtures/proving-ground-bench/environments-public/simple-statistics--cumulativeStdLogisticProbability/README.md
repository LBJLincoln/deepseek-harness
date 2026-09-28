# Implement cumulativeStdLogisticProbability from simple-statistics

`src/cumulative_std_logistic_probability.js` is the JavaScript build of `src/cumulative_std_logistic_probability.js` from simple-statistics (https://github.com/simple-statistics/simple-statistics at commit 5ee3e8be581f, ISC licence, whose text is in `LICENSE`). Every export of the module is in place except `cumulativeStdLogisticProbability`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * **[Logistic Cumulative Distribution Function](https://en.wikipedia.org/wiki/Logistic_distribution)**
 *
 * @param {number} x
 * @returns {number} cumulative standard logistic probability
 */
function cumulativeStdLogisticProbability(x)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/cumulative_std_normal_probability.js`, `src/epsilon.js`, `src/error_function.js`, `src/inverse_error_function.js`, `src/probit.js`, `src/standard_normal_table.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/cumulative_std_logistic_probability.js` of simple-statistics (https://github.com/simple-statistics/simple-statistics) at commit `5ee3e8be581ffd4a4b372d5da11cda8c53a0e6bd`, distributed under the ISC licence (Copyright (c) 2014, Tom MacWright); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
