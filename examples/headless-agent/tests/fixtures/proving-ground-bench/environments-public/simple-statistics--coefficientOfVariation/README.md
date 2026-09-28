# Implement coefficientOfVariation from simple-statistics

`src/coefficient_of_variation.js` is the JavaScript build of `src/coefficient_of_variation.js` from simple-statistics (https://github.com/simple-statistics/simple-statistics at commit 5ee3e8be581f, ISC licence, whose text is in `LICENSE`). Every export of the module is in place except `coefficientOfVariation`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * The`coefficient of variation`_ is the ratio of the standard deviation to the mean.
 * .._`coefficient of variation`: https://en.wikipedia.org/wiki/Coefficient_of_variation
 *
 *
 * @param {Array} x input
 * @returns {number} coefficient of variation
 * @example
 * coefficientOfVariation([1, 2, 3, 4]).toFixed(3); // => 0.516
 * coefficientOfVariation([1, 2, 3, 4, 5]).toFixed(3); // => 0.527
 * coefficientOfVariation([-1, 0, 1, 2, 3, 4]).toFixed(3); // => 1.247
 */
function coefficientOfVariation(x)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/mean.js`, `src/sample_standard_deviation.js`, `src/sample_variance.js`, `src/sum.js`, `src/sum_nth_power_deviations.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/coefficient_of_variation.js` of simple-statistics (https://github.com/simple-statistics/simple-statistics) at commit `5ee3e8be581ffd4a4b372d5da11cda8c53a0e6bd`, distributed under the ISC licence (Copyright (c) 2014, Tom MacWright); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
