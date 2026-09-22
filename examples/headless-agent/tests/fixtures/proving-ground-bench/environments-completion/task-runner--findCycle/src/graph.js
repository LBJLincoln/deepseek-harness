/** Ordering the task graph, and naming the cycle that stops it. */

/** A dependency cycle, carrying the names that close it. */
export class CycleError extends Error {
  /**
   * @param {string[]} names - the cycle from the re-entered task back to itself, the repeat included.
   */
  constructor(names) {
    super(`cycle: ${names.join(' -> ')}`)
    this.name = 'CycleError'
    this.names = names
  }
}

/**
 * The cycle a depth-first search finds first, or undefined when the graph is acyclic.
 * The search starts from each task in ascending name order and walks each task's
 * dependencies in ascending name order; the cycle runs from the task the search
 * re-entered, through the stack, back to that task.
 * @param {Map<string, {needs: string[]}>} tasks - the parsed tasks.
 * @returns {string[] | undefined} the cycle's names, the repeat included.
 */
export function findCycle(tasks) {
  throw new Error('not implemented')
}

/**
 * The tasks in run order: repeatedly the lexicographically smallest task whose
 * dependencies have all been emitted.
 * @param {Map<string, {needs: string[]}>} tasks - the parsed tasks.
 * @returns {string[]} the names in run order.
 * @throws {CycleError} when a dependency cycle leaves the order undefined.
 */
export function order(tasks) {
  const cycle = findCycle(tasks)
  if (cycle !== undefined) throw new CycleError(cycle)
  const remaining = new Set(tasks.keys())
  const emitted = new Set()
  const out = []
  while (remaining.size > 0) {
    const ready = [...remaining].filter(name => tasks.get(name).needs.every(need => emitted.has(need))).sort()
    const next = ready[0]
    remaining.delete(next)
    emitted.add(next)
    out.push(next)
  }
  return out
}
