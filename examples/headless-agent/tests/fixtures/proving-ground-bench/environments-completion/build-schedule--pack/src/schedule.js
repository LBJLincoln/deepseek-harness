/** The three reports: dependency waves, per-task timings, and list scheduling onto K workers. */

import { chains, timings } from './graph.js'

/**
 * The waves of an acyclic graph: wave 0 holds every task with no dependency,
 * and wave k every task whose deepest dependency sits in wave k-1.
 * @param tasks - an acyclic graph.
 * @returns the waves, each a name-sorted array; a graph with no task has no wave.
 */
export function waves(tasks) {
  const depth = new Map()
  const visit = name => {
    const known = depth.get(name)
    if (known !== undefined) return known
    let deepest = -1
    for (const dependency of tasks.get(name).deps) deepest = Math.max(deepest, visit(dependency))
    depth.set(name, deepest + 1)
    return deepest + 1
  }
  const out = []
  for (const name of [...tasks.keys()].sort()) {
    const level = visit(name)
    while (out.length <= level) out.push([])
    out[level].push(name)
  }
  return out.map(wave => wave.sort())
}

/**
 * List scheduling onto a fixed number of workers: at every instant a free
 * worker takes the ready task with the longest remaining chain, ties broken by
 * name, and a task of cost 0 frees its worker at the instant it starts.
 * @param tasks - an acyclic graph.
 * @param workers - how many workers run in parallel, at least 1.
 * @returns per worker the tasks it ran with their start and finish, and the makespan.
 */
export function pack(tasks, workers) {
  throw new Error('not implemented')
}

/**
 * Per-task timings with unlimited workers, in name order.
 * @param tasks - an acyclic graph.
 * @returns one record per task, name-sorted.
 */
export function explain(tasks) {
  const times = timings(tasks)
  return [...tasks.keys()].sort().map(name => ({ name, ...times.get(name) }))
}

/**
 * The makespan with unlimited workers: the longest chain in the graph.
 * @param tasks - an acyclic graph.
 * @returns the total, 0 for a graph with no task.
 */
export function span(tasks) {
  return Math.max(0, ...[...timings(tasks).values()].map(one => one.finish))
}
