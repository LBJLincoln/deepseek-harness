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
  const policies = new Map()
  const routes = []
  const events = []
  let last = 0
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    const at = index + 1
    if (line === '' || line.startsWith('#')) continue
    const words = line.split(/\s+/u)
    const declaring = words[0] === 'bucket' || words[0] === 'window' || words[0] === 'route'
    if (declaring && events.length > 0) throw new LimitError('declarations must come before the first event', at)
    if (words[0] === 'bucket' || words[0] === 'window') {
      const arity = words[0] === 'bucket' ? 5 : 4
      if (words.length !== arity) {
        throw new LimitError(words[0] === 'bucket' ? 'expected bucket <name> <capacity> <refill> <per>' : 'expected window <name> <limit> <span>', at)
      }
      if (!WORD.test(words[1])) throw new LimitError(`invalid policy name ${words[1]}`, at)
      if (policies.has(words[1])) throw new LimitError(`policy ${words[1]} is declared twice`, at)
      policies.set(words[1], words[0] === 'bucket'
        ? new Bucket(words[1], integer(words[2], 'capacity', 1, at), integer(words[3], 'refill', 0, at), integer(words[4], 'per', 1, at))
        : new Window(words[1], integer(words[2], 'limit', 0, at), integer(words[3], 'span', 1, at)))
      continue
    }
    if (words[0] === 'route') {
      if (words.length < 3) throw new LimitError('expected route <prefix> <policy>...', at)
      if (!WORD.test(words[1])) throw new LimitError(`invalid route prefix ${words[1]}`, at)
      if (routes.some(route => route.prefix === words[1])) throw new LimitError(`prefix ${words[1]} is routed twice`, at)
      for (const named of words.slice(2)) {
        if (!policies.has(named)) throw new LimitError(`unknown policy ${named}`, at)
      }
      routes.push({ prefix: words[1], policies: words.slice(2).map(named => policies.get(named)) })
      continue
    }
    if (words[0] === 'event') {
      if (words.length !== 3) throw new LimitError('expected event <tick> <key>', at)
      const tick = integer(words[1], 'tick', 0, at)
      if (tick < last) throw new LimitError(`tick ${tick} is before tick ${last}`, at)
      if (!WORD.test(words[2])) throw new LimitError(`invalid key ${words[2]}`, at)
      last = tick
      events.push({ tick, key: words[2] })
      continue
    }
    throw new LimitError(`unknown directive ${words[0]}`, at)
  }
  return { routes, events }
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
