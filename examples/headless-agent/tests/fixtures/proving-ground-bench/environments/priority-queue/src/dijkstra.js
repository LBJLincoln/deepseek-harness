/**
 * Single-source shortest paths over a weighted directed graph, driven by the
 * indexed heap so a shorter route to a queued node lowers its priority in
 * place instead of enqueueing a duplicate.
 */

/**
 * Computes the distance and predecessor of every node from one source.
 * @param {unknown} graph Weighted directed graph.
 * @param {string} source Node to start from.
 * @returns {{dist: Record<string, number>, prev: Record<string, string | null>}} Distances and predecessors.
 */
export function shortestPaths(graph, source) {
  throw new Error('not implemented');
}

/**
 * Finds one shortest route between two nodes.
 * @param {unknown} graph Weighted directed graph.
 * @param {string} source Node to start from.
 * @param {string} target Node to reach.
 * @returns {{distance: number, path: string[]} | null} Route, or null when unreachable.
 */
export function shortestPath(graph, source, target) {
  throw new Error('not implemented');
}
