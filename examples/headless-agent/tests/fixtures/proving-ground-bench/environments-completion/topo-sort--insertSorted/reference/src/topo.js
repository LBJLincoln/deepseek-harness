/**
 * Deterministic topological ordering of a dependency graph.
 *
 * A graph is a plain object whose own enumerable keys are node ids and whose
 * values are arrays of successor ids; an edge `a -> b` means `a` must come
 * before `b`. Node ids are compared as UTF-16 code unit sequences.
 */

/**
 * Reads and validates a graph into an adjacency map with sorted, deduplicated
 * successor lists.
 * @param {unknown} graph Candidate graph.
 * @returns {Map<string, string[]>} Adjacency map keyed by node id.
 * @throws {TypeError} When the graph or an edge list is malformed.
 * @throws {ReferenceError} When an edge names a node that is not declared.
 */
function readGraph(graph) {
  if (typeof graph !== 'object' || graph === null || Array.isArray(graph)) {
    throw new TypeError('graph must be an object');
  }
  const nodes = Object.keys(graph);
  const adjacency = new Map();
  for (const node of nodes) adjacency.set(node, []);
  for (const node of nodes) {
    const edges = graph[node];
    if (!Array.isArray(edges)) throw new TypeError(`edge list for node "${node}" must be an array`);
    const seen = new Set();
    for (const target of edges) {
      if (typeof target !== 'string') throw new TypeError(`edge list for node "${node}" must be an array`);
      if (!adjacency.has(target)) throw new ReferenceError(`unknown node: "${target}"`);
      if (!seen.has(target)) {
        seen.add(target);
        adjacency.get(node).push(target);
      }
    }
    adjacency.get(node).sort(compareIds);
  }
  return adjacency;
}

/**
 * Compares two node ids by UTF-16 code unit.
 * @param {string} a First id.
 * @param {string} b Second id.
 * @returns {number} Negative, zero, or positive.
 */
function compareIds(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * Inserts an id into a list kept in ascending order.
 * @param {string[]} sorted Ascending list.
 * @param {string} value Id to insert.
 * @returns {void}
 */
function insertSorted(sorted, value) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (compareIds(sorted[mid], value) < 0) lo = mid + 1;
    else hi = mid;
  }
  sorted.splice(lo, 0, value);
}

/**
 * Rotates a cycle so it starts at its smallest id.
 * @param {string[]} cycle Cycle in edge order.
 * @returns {string[]} Rotated cycle.
 */
function rotate(cycle) {
  let best = 0;
  for (let i = 1; i < cycle.length; i += 1) {
    if (compareIds(cycle[i], cycle[best]) < 0) best = i;
  }
  return [...cycle.slice(best), ...cycle.slice(0, best)];
}

/**
 * Finds one cycle, exploring nodes and successors in ascending id order.
 * @param {unknown} graph Dependency graph.
 * @returns {string[] | null} Cycle in edge order starting at its smallest id, or null.
 */
export function findCycle(graph) {
  const adjacency = readGraph(graph);
  const nodes = [...adjacency.keys()].sort(compareIds);
  const state = new Map(nodes.map((node) => [node, 0]));
  const stack = [];
  let found = null;

  /**
   * Depth-first walk that stops at the first back edge.
   * @param {string} node Node to explore.
   * @returns {boolean} True once a cycle has been recorded.
   */
  function visit(node) {
    state.set(node, 1);
    stack.push(node);
    for (const next of adjacency.get(node)) {
      if (state.get(next) === 1) {
        found = rotate(stack.slice(stack.indexOf(next)));
        return true;
      }
      if (state.get(next) === 0 && visit(next)) return true;
    }
    stack.pop();
    state.set(node, 2);
    return false;
  }

  for (const node of nodes) {
    if (state.get(node) === 0 && visit(node)) return found;
  }
  return null;
}

/**
 * Orders the graph with Kahn's algorithm, always taking the smallest ready id.
 * @param {unknown} graph Dependency graph.
 * @returns {{ok: true, order: string[]} | {ok: false, cycle: string[]}} Order or cycle.
 */
export function kahnOrder(graph) {
  const adjacency = readGraph(graph);
  const indegree = new Map([...adjacency.keys()].map((node) => [node, 0]));
  for (const targets of adjacency.values()) {
    for (const target of targets) indegree.set(target, indegree.get(target) + 1);
  }
  const ready = [...adjacency.keys()].filter((node) => indegree.get(node) === 0).sort(compareIds);
  const order = [];
  while (ready.length > 0) {
    const node = ready.shift();
    order.push(node);
    for (const target of adjacency.get(node)) {
      const left = indegree.get(target) - 1;
      indegree.set(target, left);
      if (left === 0) insertSorted(ready, target);
    }
  }
  if (order.length !== adjacency.size) return { ok: false, cycle: findCycle(graph) };
  return { ok: true, order };
}

/**
 * Orders the graph by reversed depth-first finishing times.
 * @param {unknown} graph Dependency graph.
 * @returns {{ok: true, order: string[]} | {ok: false, cycle: string[]}} Order or cycle.
 */
export function dfsOrder(graph) {
  const adjacency = readGraph(graph);
  const nodes = [...adjacency.keys()].sort(compareIds);
  const state = new Map(nodes.map((node) => [node, 0]));
  const finished = [];
  let cyclic = false;

  /**
   * Depth-first walk recording finishing order.
   * @param {string} node Node to explore.
   * @returns {void}
   */
  function visit(node) {
    state.set(node, 1);
    for (const next of adjacency.get(node)) {
      if (state.get(next) === 1) cyclic = true;
      else if (state.get(next) === 0) visit(next);
    }
    state.set(node, 2);
    finished.push(node);
  }

  for (const node of nodes) {
    if (state.get(node) === 0) visit(node);
  }
  if (cyclic) return { ok: false, cycle: findCycle(graph) };
  return { ok: true, order: finished.reverse() };
}

/**
 * Groups nodes into dependency levels: a node sits one level below its deepest
 * predecessor, and each level is listed in ascending id order.
 * @param {unknown} graph Dependency graph.
 * @returns {{ok: true, layers: string[][]} | {ok: false, cycle: string[]}} Levels or cycle.
 */
export function layers(graph) {
  const ordered = kahnOrder(graph);
  if (!ordered.ok) return ordered;
  const adjacency = readGraph(graph);
  const level = new Map([...adjacency.keys()].map((node) => [node, 0]));
  for (const node of ordered.order) {
    for (const target of adjacency.get(node)) {
      level.set(target, Math.max(level.get(target), level.get(node) + 1));
    }
  }
  const out = [];
  for (const node of [...adjacency.keys()].sort(compareIds)) {
    const depth = level.get(node);
    while (out.length <= depth) out.push([]);
    out[depth].push(node);
  }
  return { ok: true, layers: out };
}
