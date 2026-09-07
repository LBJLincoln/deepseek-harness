/**
 * Deterministic topological ordering of a dependency graph.
 *
 * A graph is a plain object whose own enumerable keys are node ids and whose
 * values are arrays of successor ids; an edge `a -> b` means `a` must come
 * before `b`.
 */

/**
 * Finds one cycle, exploring nodes and successors in ascending id order.
 * @param {unknown} graph Dependency graph.
 * @returns {string[] | null} Cycle in edge order starting at its smallest id, or null.
 */
export function findCycle(graph) {
  throw new Error('not implemented');
}

/**
 * Orders the graph with Kahn's algorithm, always taking the smallest ready id.
 * @param {unknown} graph Dependency graph.
 * @returns {{ok: true, order: string[]} | {ok: false, cycle: string[]}} Order or cycle.
 */
export function kahnOrder(graph) {
  throw new Error('not implemented');
}

/**
 * Orders the graph by reversed depth-first finishing times.
 * @param {unknown} graph Dependency graph.
 * @returns {{ok: true, order: string[]} | {ok: false, cycle: string[]}} Order or cycle.
 */
export function dfsOrder(graph) {
  throw new Error('not implemented');
}

/**
 * Groups nodes into dependency levels: a node sits one level below its deepest
 * predecessor, and each level is listed in ascending id order.
 * @param {unknown} graph Dependency graph.
 * @returns {{ok: true, layers: string[][]} | {ok: false, cycle: string[]}} Levels or cycle.
 */
export function layers(graph) {
  throw new Error('not implemented');
}
