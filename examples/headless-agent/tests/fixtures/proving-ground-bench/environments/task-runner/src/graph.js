/** Ordering the task graph. */

/**
 * The tasks in run order: repeatedly the lexicographically smallest task whose
 * dependencies have all been emitted. A cycle has no such task, so the order
 * stops early and leaves the tasks in it out.
 * @param {Map<string, {needs: string[]}>} tasks - the parsed tasks.
 * @returns {string[]} the names in run order.
 */
export function order(tasks) {
  const remaining = new Set(tasks.keys())
  const emitted = new Set()
  const out = []
  while (remaining.size > 0) {
    const ready = [...remaining].filter(name => tasks.get(name).needs.every(need => emitted.has(need))).sort()
    if (ready.length === 0) break
    remaining.delete(ready[0])
    emitted.add(ready[0])
    out.push(ready[0])
  }
  return out
}
