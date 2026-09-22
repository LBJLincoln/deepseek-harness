/** The snapshot reader and the staleness rule that decides what a plan runs. */

import { existsSync, readFileSync } from 'node:fs'
import { digestBytes } from './digest.js'
import { order } from './graph.js'

const DIGEST = /^[0-9a-f]{8}$/

/** One refusal of a snapshot file, carrying the file and the 1-based line. */
export class SnapshotError extends Error {
  /**
   * @param {string} message - the message the specification words, without the `error: ` prefix.
   */
  constructor(message) {
    super(message)
    this.name = 'SnapshotError'
  }
}

/**
 * Read one snapshot file into the digests it records.
 * @param {string} path - the snapshot's workspace path, as the argument gave it.
 * @returns {Map<string, string>} the recorded digest of each path.
 * @throws {SnapshotError} when the file is unreadable or a line is malformed.
 */
export function readSnapshot(path) {
  if (!existsSync(path)) throw new SnapshotError(`cannot read snapshot ${path}`)
  const recorded = new Map()
  const lines = readFileSync(path, 'utf8').split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  for (const [index, raw] of lines.entries()) {
    const line = index + 1
    const text = raw.trim()
    if (text === '' || text.startsWith('#')) continue
    const words = text.split(/\s+/u)
    if (words.length !== 2) throw new SnapshotError(`${path}: line ${line}: expected <path> <digest>`)
    if (!DIGEST.test(words[1])) throw new SnapshotError(`${path}: line ${line}: invalid digest ${words[1]}`)
    if (recorded.has(words[0])) throw new SnapshotError(`${path}: line ${line}: path ${words[0]} is recorded twice`)
    recorded.set(words[0], words[1])
  }
  return recorded
}

/**
 * Why one watched path makes its task stale, or undefined when it does not.
 * @param {string} path - the watched workspace path.
 * @param {Map<string, string>} recorded - the snapshot's digests.
 * @returns {string | undefined} the reason, as the plan line words it.
 */
function pathReason(path, recorded) {
  if (!recorded.has(path)) return `new ${path}`
  if (!existsSync(path)) return `missing ${path}`
  return digestBytes(readFileSync(path)) === recorded.get(path) ? undefined : `changed ${path}`
}

/**
 * Decide, for every task in run order, whether the plan runs it and why.
 * @param {Map<string, {needs: string[], reads: string[], writes: string[]}>} tasks - the parsed tasks.
 * @param {Map<string, string>} recorded - the snapshot's digests.
 * @returns {{name: string, reason: string | undefined}[]} one decision per task, in run order.
 */
export function plan(tasks, recorded) {
  const running = new Set()
  return order(tasks).map((name) => {
    const task = tasks.get(name)
    const watched = [...new Set([...task.reads, ...task.writes])].sort()
    let reason
    for (const path of watched) {
      reason = pathReason(path, recorded)
      if (reason !== undefined) break
    }
    if (reason === undefined) {
      const stale = [...task.needs].sort().find(need => running.has(need))
      if (stale !== undefined) reason = `needs ${stale}`
    }
    if (reason !== undefined) running.add(name)
    return { name, reason }
  })
}
