# Implement kMeansCluster from simple-statistics

`src/k_means_cluster.js` is the JavaScript build of `src/k_means_cluster.js` from simple-statistics (https://github.com/simple-statistics/simple-statistics at commit 5ee3e8be581f, ISC licence, whose text is in `LICENSE`). Every export of the module is in place except `kMeansCluster`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Perform k-means clustering.
 *
 * @param {Array<Array<number>>} points N-dimensional coordinates of points to be clustered.
 * @param {number} numCluster How many clusters to create.
 * @param {Function} randomSource An optional entropy source that generates uniform values in [0, 1).
 * @return {kMeansReturn} Labels (same length as data) and centroids (same length as numCluster).
 * @throws {Error} If any centroids wind up friendless (i.e., without associated points).
 *
 * @example
 * kMeansCluster([[0.0, 0.5], [1.0, 0.5]], 2); // => {labels: [0, 1], centroids: [[0.0, 0.5], [1.0, 0.5]]}
 */
function kMeansCluster(points, numCluster, randomSource = Math.random)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/epsilon.js`, `src/euclidean_distance.js`, `src/make_matrix.js`, `src/sample.js`, `src/shuffle.js`, `src/shuffle_in_place.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/k_means_cluster.js` of simple-statistics (https://github.com/simple-statistics/simple-statistics) at commit `5ee3e8be581ffd4a4b372d5da11cda8c53a0e6bd`, distributed under the ISC licence (Copyright (c) 2014, Tom MacWright); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
