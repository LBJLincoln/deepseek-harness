import { DisjointSets } from './dsu.js';

/**
 * Spanning-forest and what-if queries built on the rollback-capable
 * disjoint-set structure.
 *
 * An edge is `[u, v, weight]` with element indices and a finite weight.
 */

/**
 * Validates an edge list against an element count.
 * @param {unknown} edges Candidate edge list.
 * @param {number} count Element count the edges index into.
 * @returns {Array<[number, number, number]>} Copies of the validated edges.
 * @throws {TypeError} When the list or an edge is malformed.
 * @throws {RangeError} When an endpoint is outside the structure.
 */
function checkEdges(edges, count) {
  if (!Array.isArray(edges)) throw new TypeError('edges must be an array');
  return edges.map((edge) => {
    if (!Array.isArray(edge) || edge.length !== 3) throw new TypeError('edge must be [u, v, weight]');
    const [u, v, weight] = edge;
    for (const endpoint of [u, v]) {
      if (!Number.isSafeInteger(endpoint) || endpoint < 0 || endpoint >= count) {
        throw new RangeError(`element out of range: ${String(endpoint)}`);
      }
    }
    if (typeof weight !== 'number' || !Number.isFinite(weight)) throw new TypeError('weight must be a finite number');
    return [u, v, weight];
  });
}

/**
 * Builds a minimum spanning forest with Kruskal's algorithm, taking edges by
 * weight and breaking ties by the first endpoint and then the second.
 * @param {number} count Element count.
 * @param {unknown} edges Available edges.
 * @returns {{edges: Array<[number, number, number]>, weight: number, components: number}} Chosen edges, their total weight, and the remaining component count.
 */
export function minimumSpanningForest(count, edges) {
  const sets = new DisjointSets(count);
  const candidates = checkEdges(edges, count);
  candidates.sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]);
  const chosen = [];
  let weight = 0;
  for (const edge of candidates) {
    if (sets.union(edge[0], edge[1])) {
      chosen.push(edge);
      weight += edge[2];
    }
  }
  return { edges: chosen, weight, components: sets.components };
}

/**
 * Measures how many components remain after each alternative edge set is
 * added on top of a shared base, evaluating each alternative independently by
 * rolling back to the state the base left behind.
 * @param {number} count Element count.
 * @param {unknown} baseEdges Edges applied once, before any alternative.
 * @param {unknown} alternatives Array of edge lists to try one at a time.
 * @returns {{base: number, alternatives: number[]}} Component count for the base and for each alternative.
 * @throws {TypeError} When the alternatives are not an array of edge lists.
 */
export function componentsWithAlternatives(count, baseEdges, alternatives) {
  const sets = new DisjointSets(count);
  for (const [u, v] of checkEdges(baseEdges, count)) sets.union(u, v);
  if (!Array.isArray(alternatives)) throw new TypeError('alternatives must be an array');
  const mark = sets.checkpoint();
  const base = sets.components;
  const results = [];
  for (const alternative of alternatives) {
    for (const [u, v] of checkEdges(alternative, count)) sets.union(u, v);
    results.push(sets.components);
    sets.rollback(mark);
  }
  return { base, alternatives: results };
}
