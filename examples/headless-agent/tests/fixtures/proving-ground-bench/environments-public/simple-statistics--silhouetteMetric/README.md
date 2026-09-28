# Implement silhouetteMetric from simple-statistics

`src/silhouette_metric.js` is the JavaScript build of `src/silhouette_metric.js` from simple-statistics (https://github.com/simple-statistics/simple-statistics at commit 5ee3e8be581f, ISC licence, whose text is in `LICENSE`). Every export of the module is in place except `silhouetteMetric`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Calculate the [silhouette metric](https://en.wikipedia.org/wiki/Silhouette_(clustering))
 * for a set of N-dimensional points arranged in groups. The metric is the largest
 * individual silhouette value for the data.
 *
 * @param {Array<Array<number>>} points N-dimensional coordinates of points.
 * @param {Array<number>} labels Labels of points. This must be the same length as `points`,
 * and values must lie in [0..G-1], where G is the number of groups.
 * @return {number} The silhouette metric for the groupings.
 *
 * @example
 * silhouetteMetric([[0.25], [0.75]], [0, 0]); // => 1.0
 */
function silhouetteMetric(points, labels)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/approx_equal.js`, `src/epsilon.js`, `src/euclidean_distance.js`, `src/make_matrix.js`, `src/max.js`, `src/relative_error.js`, `src/silhouette.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/silhouette_metric.js` of simple-statistics (https://github.com/simple-statistics/simple-statistics) at commit `5ee3e8be581ffd4a4b372d5da11cda8c53a0e6bd`, distributed under the ISC licence (Copyright (c) 2014, Tom MacWright); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
