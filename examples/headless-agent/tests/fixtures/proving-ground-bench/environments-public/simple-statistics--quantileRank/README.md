# Implement quantileRank from simple-statistics

`src/quantile_rank.js` is the JavaScript build of `src/quantile_rank.js` from simple-statistics (https://github.com/simple-statistics/simple-statistics at commit 5ee3e8be581f, ISC licence, whose text is in `LICENSE`). Every export of the module is in place except `quantileRank`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * This function returns the quantile in which one would find the given value in
 * the given array. It will copy and sort your array before each run, so
 * if you know your array is already sorted, you should use `quantileRankSorted`
 * instead.
 *
 * @param {Array<number>} x input
 * @param {number} value the value for which to find the quantile rank
 * @returns {number} the quantile rank
 * @example
 * quantileRank([4, 3, 1, 2], 3); // => 0.75
 * quantileRank([4, 3, 2, 3, 1], 3); // => 0.7
 * quantileRank([2, 4, 1, 3], 6); // => 1
 * quantileRank([5, 3, 1, 2, 3], 4); // => 0.8
 */
function quantileRank(x, value)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/numeric_sort.js`, `src/quantile_rank_sorted.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/quantile_rank.js` of simple-statistics (https://github.com/simple-statistics/simple-statistics) at commit `5ee3e8be581ffd4a4b372d5da11cda8c53a0e6bd`, distributed under the ISC licence (Copyright (c) 2014, Tom MacWright); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
