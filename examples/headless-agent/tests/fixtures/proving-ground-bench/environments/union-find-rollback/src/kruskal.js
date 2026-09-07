/**
 * Spanning-forest and what-if queries built on the rollback-capable
 * disjoint-set structure.
 *
 * An edge is `[u, v, weight]` with element indices and a finite weight.
 */

/**
 * Builds a minimum spanning forest with Kruskal's algorithm, taking edges by
 * weight and breaking ties by the first endpoint and then the second.
 * @param {number} count Element count.
 * @param {unknown} edges Available edges.
 * @returns {{edges: Array<[number, number, number]>, weight: number, components: number}} Chosen edges, their total weight, and the remaining component count.
 */
export function minimumSpanningForest(count, edges) {
  throw new Error('not implemented');
}

/**
 * Measures how many components remain after each alternative edge set is
 * added on top of a shared base, evaluating each alternative independently by
 * rolling back to the state the base left behind.
 * @param {number} count Element count.
 * @param {unknown} baseEdges Edges applied once, before any alternative.
 * @param {unknown} alternatives Array of edge lists to try one at a time.
 * @returns {{base: number, alternatives: number[]}} Component count for the base and for each alternative.
 */
export function componentsWithAlternatives(count, baseEdges, alternatives) {
  throw new Error('not implemented');
}
