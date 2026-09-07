import { IndexedHeap } from './heap.js';

/**
 * Single-source shortest paths over a weighted directed graph, driven by the
 * indexed heap so a shorter route to a queued node lowers its priority in
 * place instead of enqueueing a duplicate.
 *
 * A graph is a plain object mapping a node id to an object of successor ids
 * and weights, each weight a finite number greater than zero.
 */

/**
 * Validates a graph and returns its node ids in ascending order.
 * @param {unknown} graph Candidate graph.
 * @returns {string[]} Sorted node ids.
 * @throws {TypeError} When the graph or an edge map is malformed.
 * @throws {ReferenceError} When an edge names an undeclared node.
 * @throws {RangeError} When a weight is not positive and finite.
 */
function readGraph(graph) {
  if (typeof graph !== 'object' || graph === null || Array.isArray(graph)) {
    throw new TypeError('graph must be an object');
  }
  const nodes = Object.keys(graph).sort();
  const known = new Set(nodes);
  for (const node of nodes) {
    const edges = graph[node];
    if (typeof edges !== 'object' || edges === null || Array.isArray(edges)) {
      throw new TypeError(`edge map for node "${node}" must be an object`);
    }
    for (const target of Object.keys(edges)) {
      if (!known.has(target)) throw new ReferenceError(`unknown node: "${target}"`);
      const weight = edges[target];
      if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) {
        throw new RangeError(`weight must be positive: "${node}" -> "${target}"`);
      }
    }
  }
  return nodes;
}

/**
 * Computes the distance and predecessor of every node from one source.
 *
 * Where several shortest routes tie, the predecessor is the smallest source id
 * among them, so the result does not depend on the order nodes were settled.
 * @param {unknown} graph Weighted directed graph.
 * @param {string} source Node to start from.
 * @returns {{dist: Record<string, number>, prev: Record<string, string | null>}} Distances and predecessors.
 * @throws {ReferenceError} When the source is not a node of the graph.
 */
export function shortestPaths(graph, source) {
  const nodes = readGraph(graph);
  if (typeof source !== 'string') throw new TypeError('source must be a string');
  if (!nodes.includes(source)) throw new ReferenceError(`unknown node: "${source}"`);

  /** @type {Record<string, number>} */
  const dist = {};
  /** @type {Record<string, string | null>} */
  const prev = {};
  for (const node of nodes) {
    dist[node] = Number.POSITIVE_INFINITY;
    prev[node] = null;
  }
  dist[source] = 0;

  const settled = new Set();
  const queue = new IndexedHeap();
  queue.push(source, 0);
  while (queue.size > 0) {
    const { key: node } = queue.pop();
    settled.add(node);
    for (const target of Object.keys(graph[node]).sort()) {
      if (settled.has(target)) continue;
      const candidate = dist[node] + graph[node][target];
      if (candidate < dist[target]) {
        dist[target] = candidate;
        prev[target] = node;
        if (queue.has(target)) queue.decreaseKey(target, candidate);
        else queue.push(target, candidate);
      } else if (candidate === dist[target] && prev[target] !== null && node < prev[target]) {
        prev[target] = node;
      }
    }
  }
  return { dist, prev };
}

/**
 * Finds one shortest route between two nodes.
 * @param {unknown} graph Weighted directed graph.
 * @param {string} source Node to start from.
 * @param {string} target Node to reach.
 * @returns {{distance: number, path: string[]} | null} Route, or null when unreachable.
 * @throws {ReferenceError} When either endpoint is not a node of the graph.
 */
export function shortestPath(graph, source, target) {
  const { dist, prev } = shortestPaths(graph, source);
  if (typeof target !== 'string') throw new TypeError('target must be a string');
  if (!Object.hasOwn(dist, target)) throw new ReferenceError(`unknown node: "${target}"`);
  if (dist[target] === Number.POSITIVE_INFINITY) return null;
  const path = [target];
  for (let node = prev[target]; node !== null; node = prev[node]) path.unshift(node);
  return { distance: dist[target], path };
}
