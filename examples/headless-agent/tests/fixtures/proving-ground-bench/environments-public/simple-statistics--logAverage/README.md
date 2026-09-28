# Implement logAverage from simple-statistics

`src/log_average.js` is the JavaScript build of `src/log_average.js` from simple-statistics (https://github.com/simple-statistics/simple-statistics at commit 5ee3e8be581f, ISC licence, whose text is in `LICENSE`). Every export of the module is in place except `logAverage`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * The [log average](https://en.wikipedia.org/wiki/https://en.wikipedia.org/wiki/Geometric_mean#Relationship_with_logarithms)
 * is an equivalent way of computing the geometric mean of an array suitable for large or small products.
 *
 * It's found by calculating the average logarithm of the elements and exponentiating.
 *
 * @param {Array<number>} x sample of one or more data points
 * @returns {number} geometric mean
 * @throws {Error} if x is empty
 * @throws {Error} if x contains a negative number
 */
function logAverage(x)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/epsilon.js`, `src/geometric_mean.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/log_average.js` of simple-statistics (https://github.com/simple-statistics/simple-statistics) at commit `5ee3e8be581ffd4a4b372d5da11cda8c53a0e6bd`, distributed under the ISC licence (Copyright (c) 2014, Tom MacWright); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
