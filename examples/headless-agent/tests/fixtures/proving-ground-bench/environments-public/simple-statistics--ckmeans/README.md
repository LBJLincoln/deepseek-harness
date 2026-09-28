# Implement ckmeans from simple-statistics

`src/ckmeans.js` is the JavaScript build of `src/ckmeans.js` from simple-statistics (https://github.com/simple-statistics/simple-statistics at commit 5ee3e8be581f, ISC licence, whose text is in `LICENSE`). Every export of the module is in place except `ckmeans`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Ckmeans clustering is an improvement on heuristic-based clustering
 * approaches like Jenks. The algorithm was developed in
 * [Haizhou Wang and Mingzhou Song](http://journal.r-project.org/archive/2011-2/RJournal_2011-2_Wang+Song.pdf)
 * as a [dynamic programming](https://en.wikipedia.org/wiki/Dynamic_programming) approach
 * to the problem of clustering numeric data into groups with the least
 * within-group sum-of-squared-deviations.
 *
 * Minimizing the difference within groups - what Wang & Song refer to as
 * `withinss`, or within sum-of-squares, means that groups are optimally
 * homogenous within and the data is split into representative groups.
 * This is very useful for visualization, where you may want to represent
 * a continuous variable in discrete color or style groups. This function
 * can provide groups that emphasize differences between data.
 *
 * Being a dynamic approach, this algorithm is based on two matrices that
 * store incrementally-computed values for squared deviations and backtracking
 * indexes.
 *
 * This implementation is based on Ckmeans 3.4.6, which introduced a new divide
 * and conquer approach that improved runtime from O(kn^2) to O(kn log(n)).
 *
 * Unlike the [original implementation](https://cran.r-project.org/web/packages/Ckmeans.1d.dp/index.html),
 * this implementation does not include any code to automatically determine
 * the optimal number of clusters: this information needs to be explicitly
 * provided.
 *
 * ### References
 * _Ckmeans.1d.dp: Optimal k-means Clustering in One Dimension by Dynamic
 * Programming_ Haizhou Wang and Mingzhou Song ISSN 2073-4859
 *
 * from The R Journal Vol. 3/2, December 2011
 * @param {Array<number>} x input data, as an array of number values
 * @param {number} nClusters number of desired classes. This cannot be
 * greater than the number of values in the data array.
 * @returns {Array<Array<number>>} clustered input
 * @throws {Error} if the number of requested clusters is higher than the size of the data
 * @example
 * ckmeans([-1, 2, -1, 2, 4, 5, 6, -1, 2, -1], 3);
 * // The input, clustered into groups of similar numbers.
 * //= [[-1, -1, -1, -1], [2, 2, 2], [4, 5, 6]]);
 */
function ckmeans(x, nClusters)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/make_matrix.js`, `src/numeric_sort.js`, `src/unique_count_sorted.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/ckmeans.js` of simple-statistics (https://github.com/simple-statistics/simple-statistics) at commit `5ee3e8be581ffd4a4b372d5da11cda8c53a0e6bd`, distributed under the ISC licence (Copyright (c) 2014, Tom MacWright); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
