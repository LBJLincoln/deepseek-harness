# Implement relativeError from simple-statistics

`src/relative_error.js` is the JavaScript build of `src/relative_error.js` from simple-statistics (https://github.com/simple-statistics/simple-statistics at commit 5ee3e8be581f, ISC licence, whose text is in `LICENSE`). Every export of the module is in place except `relativeError`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Relative error.
 *
 * This is more difficult to calculate than it first appears [1,2].  The usual
 * formula for the relative error between an actual value A and an expected
 * value E is `|(A-E)/E|`, but:
 *
 * 1. If the expected value is 0, any other value has infinite relative error,
 *    which is counter-intuitive: if the expected voltage is 0, getting 1/10th
 *    of a volt doesn't feel like an infinitely large error.
 *
 * 2. This formula does not satisfy the mathematical definition of a metric [3].
 *    [4] solved this problem by defining the relative error as `|ln(|A/E|)|`,
 *    but that formula only works if all values are positive: for example, it
 *    reports the relative error of -10 and 10 as 0.
 *
 * Our implementation sticks with convention and returns:
 *
 * - 0 if the actual and expected values are both zero
 * - Infinity if the actual value is non-zero and the expected value is zero
 * - `|(A-E)/E|` in all other cases
 *
 * [1] https://math.stackexchange.com/questions/677852/how-to-calculate-relative-error-when-true-value-is-zero
 * [2] https://en.wikipedia.org/wiki/Relative_change_and_difference
 * [3] https://en.wikipedia.org/wiki/Metric_(mathematics)#Definition
 * [4] F.W.J. Olver: "A New Approach to Error Arithmetic." SIAM Journal on
 *     Numerical Analysis, 15(2), 1978, 10.1137/0715024.
 *
 * @param {number} actual The actual value.
 * @param {number} expected The expected value.
 * @return {number} The relative error.
 */
function relativeError(actual, expected)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/relative_error.js` of simple-statistics (https://github.com/simple-statistics/simple-statistics) at commit `5ee3e8be581ffd4a4b372d5da11cda8c53a0e6bd`, distributed under the ISC licence (Copyright (c) 2014, Tom MacWright); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
