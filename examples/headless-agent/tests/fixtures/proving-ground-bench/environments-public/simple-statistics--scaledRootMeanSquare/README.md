# Implement scaledRootMeanSquare from simple-statistics

`src/scaled_root_mean_square.js` is the JavaScript build of `src/scaled_root_mean_square.js` from simple-statistics (https://github.com/simple-statistics/simple-statistics at commit 5ee3e8be581f, ISC licence, whose text is in `LICENSE`). Every export of the module is in place except `scaledRootMeanSquare`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * The [root mean square](https://en.wikipedia.org/wiki/Root_mean_square)
 * computed by scaling, which is an equivalent way of computing
 * `rootMeanSquare` suitable for values whose squares leave floating point
 * range.
 *
 * `rootMeanSquare` sums the squares directly, so it returns `Infinity` once
 * a value exceeds about 1e154 and `0` once every value falls below about
 * 1e-162. This function divides through by the largest magnitude first, so
 * the squares it sums are all at most one.
 *
 * It runs in `O(n)`, linear time, with respect to the length of the array,
 * in two passes rather than one.
 *
 * @param {Array<number>} x a sample of one or more data points
 * @returns {number} root mean square
 * @throws {Error} if x is empty
 * @example
 * scaledRootMeanSquare([-1, 1, -1, 1]); // => 1
 * scaledRootMeanSquare([1e200, 2e200, 3e200]); // => 2.1602468994692866e+200
 */
function scaledRootMeanSquare(x)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/root_mean_square.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/scaled_root_mean_square.js` of simple-statistics (https://github.com/simple-statistics/simple-statistics) at commit `5ee3e8be581ffd4a4b372d5da11cda8c53a0e6bd`, distributed under the ISC licence (Copyright (c) 2014, Tom MacWright); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
