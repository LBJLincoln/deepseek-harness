# Implement rSquared from simple-statistics

`src/r_squared.js` is the JavaScript build of `src/r_squared.js` from simple-statistics (https://github.com/simple-statistics/simple-statistics at commit 5ee3e8be581f, ISC licence, whose text is in `LICENSE`). Every export of the module is in place except `rSquared`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * The [R Squared](http://en.wikipedia.org/wiki/Coefficient_of_determination)
 * value of data compared with a function `f`
 * is the sum of the squared differences between the prediction
 * and the actual value.
 *
 * @param {Array<Array<number>>} x input data: this should be doubly-nested
 * @param {Function} func function called on `[i][0]` values within the dataset
 * @returns {number} r-squared value
 * @example
 * var samples = [[0, 0], [1, 1]];
 * var regressionLine = linearRegressionLine(linearRegression(samples));
 * rSquared(samples, regressionLine); // = 1 this line is a perfect fit
 */
function rSquared(x, func)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/linear_regression.js`, `src/linear_regression_line.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/r_squared.js` of simple-statistics (https://github.com/simple-statistics/simple-statistics) at commit `5ee3e8be581ffd4a4b372d5da11cda8c53a0e6bd`, distributed under the ISC licence (Copyright (c) 2014, Tom MacWright); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
