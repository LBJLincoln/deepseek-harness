import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shortestPath, shortestPaths } from '../src/dijkstra.js';

/** Infinity, as it appears in a distance map. */
const FAR = Number.POSITIVE_INFINITY;

/**
 * Deterministic 32-bit PRNG.
 * @param {number} seed Initial state.
 * @returns {() => number} Generator returning floats in [0, 1).
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Computes distances with Bellman-Ford as an independent model.
 * @param {Record<string, Record<string, number>>} graph Weighted graph.
 * @param {string} source Start node.
 * @returns {Record<string, number>} Distance per node.
 */
function bellmanFord(graph, source) {
  const nodes = Object.keys(graph);
  const dist = {};
  for (const node of nodes) dist[node] = FAR;
  dist[source] = 0;
  for (let round = 0; round < nodes.length; round += 1) {
    for (const node of nodes) {
      if (dist[node] === FAR) continue;
      for (const [target, weight] of Object.entries(graph[node])) {
        if (dist[node] + weight < dist[target]) dist[target] = dist[node] + weight;
      }
    }
  }
  return dist;
}

/** Small hand-checked graph. */
const graph = {
  a: { b: 1, c: 4 },
  b: { c: 2, d: 6 },
  c: { d: 3 },
  d: {},
  island: {},
};

test('computes distances and predecessors from one source', () => {
  const { dist, prev } = shortestPaths(graph, 'a');
  assert.deepEqual(dist, { a: 0, b: 1, c: 3, d: 6, island: FAR });
  assert.deepEqual(prev, { a: null, b: 'a', c: 'b', d: 'c', island: null });
  assert.deepEqual(shortestPaths(graph, 'c').dist, { a: FAR, b: FAR, c: 0, d: 3, island: FAR });
  assert.deepEqual(shortestPaths(graph, 'd').prev, { a: null, b: null, c: null, d: null, island: null });
});

test('reconstructs a route or reports that none exists', () => {
  assert.deepEqual(shortestPath(graph, 'a', 'd'), { distance: 6, path: ['a', 'b', 'c', 'd'] });
  assert.deepEqual(shortestPath(graph, 'a', 'a'), { distance: 0, path: ['a'] });
  assert.deepEqual(shortestPath(graph, 'b', 'd'), { distance: 5, path: ['b', 'c', 'd'] });
  assert.equal(shortestPath(graph, 'a', 'island'), null);
  assert.equal(shortestPath(graph, 'd', 'a'), null);
});

test('ties pick the smallest predecessor', () => {
  const tie = { s: { m: 2, n: 2 }, m: { t: 3 }, n: { t: 3 }, t: {} };
  assert.deepEqual(shortestPaths(tie, 's').prev, { s: null, m: 's', n: 's', t: 'm' });
  assert.deepEqual(shortestPath(tie, 's', 't'), { distance: 5, path: ['s', 'm', 't'] });
  const flipped = { s: { n: 2, m: 2 }, n: { t: 3 }, m: { t: 3 }, t: {} };
  assert.deepEqual(shortestPath(flipped, 's', 't'), { distance: 5, path: ['s', 'm', 't'] });
});

test('rejects malformed graphs and unknown endpoints', () => {
  const bad = [
    [() => shortestPaths(null, 'a'), 'TypeError', 'graph must be an object'],
    [() => shortestPaths([{ a: 1 }], 'a'), 'TypeError', 'graph must be an object'],
    [() => shortestPaths({ a: ['b'], b: {} }, 'a'), 'TypeError', 'edge map for node "a" must be an object'],
    [() => shortestPaths({ a: { q: 1 } }, 'a'), 'ReferenceError', 'unknown node: "q"'],
    [() => shortestPaths({ a: { b: 0 }, b: {} }, 'a'), 'RangeError', 'weight must be positive: "a" -> "b"'],
    [() => shortestPaths({ a: { b: -2 }, b: {} }, 'a'), 'RangeError', 'weight must be positive: "a" -> "b"'],
    [() => shortestPaths({ a: { b: '3' }, b: {} }, 'a'), 'RangeError', 'weight must be positive: "a" -> "b"'],
    [() => shortestPaths(graph, 'zz'), 'ReferenceError', 'unknown node: "zz"'],
    [() => shortestPath(graph, 'a', 'zz'), 'ReferenceError', 'unknown node: "zz"'],
    [() => shortestPaths(graph, 7), 'TypeError', 'source must be a string'],
  ];
  for (const [call, name, message] of bad) assert.throws(call, { name, message }, message);
});

test('agrees with Bellman-Ford on random weighted graphs', () => {
  const rnd = mulberry32(0xd1357a);
  for (let round = 0; round < 60; round += 1) {
    const size = 5 + Math.floor(rnd() * 8);
    const ids = Array.from({ length: size }, (_, i) => `n${String(i).padStart(2, '0')}`);
    const random = {};
    for (const id of ids) random[id] = {};
    for (const from of ids) {
      for (const to of ids) {
        if (from !== to && rnd() < 0.3) random[from][to] = 1 + Math.floor(rnd() * 9);
      }
    }
    const source = ids[Math.floor(rnd() * ids.length)];
    const { dist, prev } = shortestPaths(random, source);
    assert.deepEqual(dist, bellmanFord(random, source), `round ${round}`);
    assert.equal(prev[source], null, `round ${round} source predecessor`);
    for (const node of ids) {
      if (node === source || dist[node] === FAR) {
        assert.equal(prev[node], null, `round ${round} ${node} unreachable`);
        continue;
      }
      const candidates = ids.filter((from) => random[from][node] !== undefined && dist[from] + random[from][node] === dist[node]);
      assert.equal(prev[node], candidates.sort()[0], `round ${round} predecessor of ${node}`);
      const route = shortestPath(random, source, node);
      let walked = 0;
      for (let i = 1; i < route.path.length; i += 1) walked += random[route.path[i - 1]][route.path[i]];
      assert.deepEqual([route.distance, walked, route.path[0]], [dist[node], dist[node], source], `round ${round} route to ${node}`);
    }
  }
});
