import { test } from 'node:test';
import assert from 'node:assert/strict';

import { componentsWithAlternatives, minimumSpanningForest } from '../src/kruskal.js';

test('builds a minimum spanning tree in weight order', () => {
  const edges = [[0, 1, 1], [1, 2, 2], [0, 2, 2], [3, 4, 1], [2, 3, 5], [0, 3, 7]];
  assert.deepEqual(minimumSpanningForest(5, edges), {
    edges: [[0, 1, 1], [3, 4, 1], [0, 2, 2], [2, 3, 5]],
    weight: 9,
    components: 1,
  });
  assert.deepEqual(minimumSpanningForest(5, []), { edges: [], weight: 0, components: 5 });
  assert.deepEqual(minimumSpanningForest(0, []), { edges: [], weight: 0, components: 0 });
});

test('leaves a forest when the graph is disconnected and ignores useless edges', () => {
  assert.deepEqual(minimumSpanningForest(5, [[0, 1, 3], [2, 3, 4]]), {
    edges: [[0, 1, 3], [2, 3, 4]],
    weight: 7,
    components: 3,
  });
  assert.deepEqual(minimumSpanningForest(3, [[0, 0, 1], [0, 1, 2], [1, 0, 3]]), {
    edges: [[0, 1, 2]],
    weight: 2,
    components: 2,
  });
  assert.deepEqual(minimumSpanningForest(4, [[2, 3, 5], [0, 1, 5], [1, 2, 5], [0, 3, 5]]).edges, [
    [0, 1, 5], [0, 3, 5], [1, 2, 5],
  ]);
  assert.deepEqual(minimumSpanningForest(3, [[0, 1, -2], [1, 2, -3]]).weight, -5);
});

test('alternatives are measured independently of one another', () => {
  const result = componentsWithAlternatives(6, [[0, 1, 1]], [
    [[2, 3, 1]],
    [[2, 3, 1], [3, 4, 1]],
    [[0, 1, 9]],
    [],
  ]);
  assert.deepEqual(result, { base: 5, alternatives: [4, 3, 5, 5] });
  assert.deepEqual(componentsWithAlternatives(3, [], []), { base: 3, alternatives: [] });
  assert.deepEqual(
    componentsWithAlternatives(4, [[0, 1, 1], [2, 3, 1]], [[[1, 2, 1]], [[1, 2, 1]], [[0, 3, 1]]]),
    { base: 2, alternatives: [1, 1, 1] },
  );
});

test('rejects malformed edges', () => {
  const bad = [
    [() => minimumSpanningForest(3, 'edges'), 'TypeError', 'edges must be an array'],
    [() => minimumSpanningForest(3, [[0, 1]]), 'TypeError', 'edge must be [u, v, weight]'],
    [() => minimumSpanningForest(3, [{ u: 0, v: 1, w: 2 }]), 'TypeError', 'edge must be [u, v, weight]'],
    [() => minimumSpanningForest(3, [[0, 1, '2']]), 'TypeError', 'weight must be a finite number'],
    [() => minimumSpanningForest(3, [[0, 1, Number.POSITIVE_INFINITY]]), 'TypeError', 'weight must be a finite number'],
    [() => minimumSpanningForest(3, [[0, 4, 1]]), 'RangeError', 'element out of range: 4'],
    [() => minimumSpanningForest(3, [[-1, 0, 1]]), 'RangeError', 'element out of range: -1'],
    [() => componentsWithAlternatives(3, [], 'nope'), 'TypeError', 'alternatives must be an array'],
    [() => componentsWithAlternatives(3, [], [[[0, 9, 1]]]), 'RangeError', 'element out of range: 9'],
  ];
  for (const [call, name, message] of bad) assert.throws(call, { name, message }, message);
});
