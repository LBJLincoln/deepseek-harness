/** The build graph: parsing the directive lines, and the cycle report a bad graph earns. */

/** Raised for input the specification rejects; `line` is 0 when the failure has no line. */
export class GraphError extends Error {
  /**
   * @param message - the reported reason.
   * @param line - the 1-based input line, or 0 when the failure names none.
   */
  constructor(message, line) {
    super(message)
    this.name = 'GraphError'
    this.line = line
  }
}

/** A task name: letters, digits, underscore, dash and dot, at least one character. */
const NAME = /^[A-Za-z0-9_.-]+$/u

/** A cost: an unsigned decimal integer with no sign and no separators. */
const COST = /^\d+$/u

/**
 * Parse the directive lines into tasks and their dependency sets.
 * @param lines - the input lines, in order.
 * @returns a map from task name to `{ cost, deps }`, with `deps` a sorted array of names.
 * @throws {GraphError} for an unknown directive, a bad cost, a redeclared task, or a name never declared.
 */
export function parse(lines) {
  throw new Error('not implemented')
}

/**
 * The first cycle a name-ordered depth-first search meets, walking each task's
 * dependencies in name order.
 * @param tasks - the parsed graph.
 * @returns the cycle as names from the repeated task back to itself, or `undefined` when the graph is acyclic.
 */
export function findCycle(tasks) {
  const state = new Map([...tasks.keys()].map(name => [name, 'new']))
  const stack = []
  let found
  const walk = name => {
    if (found !== undefined) return
    state.set(name, 'open')
    stack.push(name)
    for (const dependency of tasks.get(name).deps) {
      if (found !== undefined) break
      if (state.get(dependency) === 'open') {
        found = [...stack.slice(stack.indexOf(dependency)), dependency]
        break
      }
      if (state.get(dependency) === 'new') walk(dependency)
    }
    stack.pop()
    if (found === undefined) state.set(name, 'done')
  }
  for (const name of [...tasks.keys()].sort()) {
    if (found !== undefined) break
    if (state.get(name) === 'new') walk(name)
  }
  return found
}

/**
 * Earliest finish time of every task with unlimited workers, which is also the
 * cost of the longest chain ending at it.
 * @param tasks - an acyclic graph.
 * @returns a map from name to `{ start, finish, depth }`.
 */
export function timings(tasks) {
  const out = new Map()
  const visit = name => {
    const known = out.get(name)
    if (known !== undefined) return known
    const task = tasks.get(name)
    let start = 0
    let depth = 0
    for (const dependency of task.deps) {
      const resolved = visit(dependency)
      start = Math.max(start, resolved.finish)
      depth = Math.max(depth, resolved.depth + 1)
    }
    const timing = { start, finish: start + task.cost, depth }
    out.set(name, timing)
    return timing
  }
  for (const name of [...tasks.keys()].sort()) visit(name)
  return out
}

/**
 * The cost of the longest chain that starts at each task, used as the priority
 * of the packing scheduler.
 * @param tasks - an acyclic graph.
 * @returns a map from name to that chain's total cost, including the task itself.
 */
export function chains(tasks) {
  const dependents = new Map([...tasks.keys()].map(name => [name, []]))
  for (const [name, task] of tasks) {
    for (const dependency of task.deps) dependents.get(dependency).push(name)
  }
  const out = new Map()
  const visit = name => {
    const known = out.get(name)
    if (known !== undefined) return known
    let longest = 0
    for (const dependent of dependents.get(name).sort()) longest = Math.max(longest, visit(dependent))
    const total = tasks.get(name).cost + longest
    out.set(name, total)
    return total
  }
  for (const name of [...tasks.keys()].sort()) visit(name)
  return out
}
