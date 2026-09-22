/** Parsing the limiter file and replaying its event log through the routed policies. */

import { Bucket, Window } from './policy.js'

/** Raised for input the specification rejects; `line` is the 1-based input line. */
export class LimitError extends Error {
  /**
   * @param message - the reported reason.
   * @param line - the 1-based input line.
   */
  constructor(message, line) {
    super(message)
    this.name = 'LimitError'
    this.line = line
  }
}

/** A policy name, a route prefix, or an event key: letters, digits, and `_ - . / :`. */
const WORD = /^[A-Za-z0-9_./:-]+$/u

/** An unsigned decimal integer, written without a sign and without a leading zero unless it is `0`. */
const NUMBER = /^(?:0|[1-9]\d*)$/u

/** Read one field as an integer of at least `least`. */
function integer(text, field, least, line) {
  if (!NUMBER.test(text) || Number(text) < least) {
    throw new LimitError(`${field} must be an integer of at least ${least}`, line)
  }
  return Number(text)
}

/**
 * Parse the directive lines into the declared policies, the routes, and the log.
 * @param lines - the input lines, in order.
 * @returns the policies by name, the routes as `{ prefix, policies }`, and the events.
 * @throws {LimitError} for any malformed or out-of-order directive.
 */
export function parse(lines) {
  throw new Error('not implemented')
}

/**
 * Replay the log: every routed policy advances to the event's tick, all of them
 * must allow it, and only then does each of them record it.
 * @param routes - the declared routes, in declaration order.
 * @param events - the log, in tick order.
 * @returns one verdict per event, carrying the denying policy's name when it was denied.
 */
export function replay(routes, events) {
  return events.map(event => {
    const matching = routes
      .filter(route => event.key.startsWith(route.prefix))
      .sort((left, right) => right.prefix.length - left.prefix.length)[0]
    if (matching === undefined) return { ...event, allowed: true }
    // Every routed policy reaches the event's tick before any of them is asked,
    // so a deny by an early policy still leaves the later ones refilled.
    for (const policy of matching.policies) policy.advance(event.key, event.tick)
    const refused = matching.policies.find(policy => !policy.allows(event.key, event.tick))
    if (refused !== undefined) return { ...event, allowed: false, by: refused.name }
    for (const policy of matching.policies) policy.take(event.key, event.tick)
    return { ...event, allowed: true }
  })
}
