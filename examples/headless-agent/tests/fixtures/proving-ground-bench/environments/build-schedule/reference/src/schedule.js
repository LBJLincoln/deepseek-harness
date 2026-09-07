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
  const priority = chains(tasks)
  const assigned = new Map()
  const lanes = Array.from({ length: workers }, () => [])
  const free = Array.from({ length: workers }, () => 0)
  const pending = new Set(tasks.keys())
  let now = 0
  while (pending.size > 0) {
    // Readiness is recomputed after every placement, because a task of cost 0
    // finishes at the instant it starts and can unblock its dependents at once.
    for (;;) {
      const worker = free.findIndex(when => when <= now)
      if (worker === -1) break
      const ready = [...pending]
        .filter(name => tasks.get(name).deps.every(dependency => (assigned.get(dependency)?.finish ?? Infinity) <= now))
        .sort((left, right) => priority.get(right) - priority.get(left) || (left < right ? -1 : 1))
      if (ready.length === 0) break
      const name = ready[0]
      const finish = now + tasks.get(name).cost
      assigned.set(name, { worker, start: now, finish })
      lanes[worker].push({ name, start: now, finish })
      free[worker] = finish
      pending.delete(name)
    }
    if (pending.size === 0) break
    // Nothing more fits at this instant, so advance to the next moment a worker
    // frees up; an acyclic graph always leaves one such moment ahead.
    now = Math.min(...[...free, ...[...assigned.values()].map(one => one.finish)].filter(when => when > now))
  }
  const makespan = Math.max(0, ...[...assigned.values()].map(one => one.finish))
  return { lanes, makespan }
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
