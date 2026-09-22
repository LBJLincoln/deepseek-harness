/** The document: headers, dotted keys, and the tree they build. */

import { ConfError, Reader } from './value.js'

/** A table node the parser builds; `explicit` marks one a header declared itself. */
function table() {
  return { type: 'table', value: new Map(), explicit: false }
}

/** Walk to the table at `parts`, creating the tables on the way. */
function descend(root, parts, path) {
  let current = root
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    let next = current.value.get(part)
    if (next === undefined) {
      next = table()
      current.value.set(part, next)
    } else if (next.type === 'tables') next = next.value[next.value.length - 1]
    if (next.type !== 'table') throw new ConfError(`${[...path, ...parts.slice(0, index + 1)].join('.')} is not a table`)
    current = next
  }
  return current
}

/** Require the rest of a line to be blank or a comment. */
function endOfLine(reader, what) {
  reader.skip()
  const rest = reader.peek()
  if (rest !== undefined && rest !== '#' && rest !== ';') throw new ConfError(`trailing text after ${what}`)
}

/**
 * Parse the whole document into a tree of tables, arrays of tables, and values.
 * @param lines - the input lines, in order.
 * @returns the root table.
 * @throws {ConfError} carrying a `line` for any malformed or conflicting directive.
 */
export function parse(lines) {
  throw new Error('not implemented')
}

/** The plain JSON value of one node, with every table's keys sorted. */
export function toJson(node) {
  if (node.type === 'table') {
    return Object.fromEntries([...node.value.keys()].sort().map(key => [key, toJson(node.value.get(key))]))
  }
  if (node.type === 'tables' || node.type === 'array') return node.value.map(toJson)
  return node.value
}

/**
 * Every node below the root, as a dotted path and the type it holds.
 * @param node - the node to walk.
 * @param path - the path already walked.
 * @returns one `{ path, type }` per node below this one, tables' keys in sorted order.
 */
export function walk(node, path = '') {
  const out = []
  if (node.type === 'table') {
    for (const key of [...node.value.keys()].sort()) {
      const child = node.value.get(key)
      const childPath = path === '' ? key : `${path}.${key}`
      out.push({ path: childPath, type: child.type === 'tables' ? 'array' : child.type })
      out.push(...walk(child, childPath))
    }
    return out
  }
  if (node.type === 'tables' || node.type === 'array') {
    node.value.forEach((child, index) => {
      const childPath = `${path}[${index}]`
      out.push({ path: childPath, type: child.type === 'tables' ? 'array' : child.type })
      out.push(...walk(child, childPath))
    })
  }
  return out
}
