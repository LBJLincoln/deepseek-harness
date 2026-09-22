/** The log grammar: the directives, and the failures each one words. */

const ID = /^[A-Za-z0-9_.-]+$/
const DIGITS = /^[0-9]+$/

/** One refusal of an input line, carrying the 1-based line, or 0 when the failure names none. */
export class LogError extends Error {
  /**
   * @param {number} line - the 1-based input line, or 0 when the failure names no line.
   * @param {string} message - the message the specification words, without the position.
   */
  constructor(line, message) {
    super(message)
    this.name = 'LogError'
    this.line = line
  }
}

/**
 * Every input line, with the empty tail a trailing newline leaves dropped.
 * @param {string} text - the whole input.
 * @returns {string[]} the lines.
 */
export function splitLines(text) {
  const split = text.split('\n')
  if (split.length > 0 && split[split.length - 1] === '') split.pop()
  return split
}

/** One field read as a non-negative integer, or the failure that names it. */
function count(line, field, word) {
  if (!DIGITS.test(word)) throw new LogError(line, `${field} must be a non-negative integer`)
  return Number(word)
}

/** One field read as a positive integer, or the failure that names it. */
function positive(line, field, word) {
  const value = count(line, field, word)
  if (value < 1) throw new LogError(line, `${field} must be a positive integer`)
  return value
}

/**
 * Read one `limit` or `retry` line into the policy it sets.
 * @param {number} line - the 1-based line the directive was read at.
 * @param {string[]} words - the line's words.
 * @param {{limit?: {starts: number, window: number}, retry?: {max: number, base: number}}} policy - the policy so far, edited in place.
 * @returns {boolean} whether the directive was a policy one.
 * @throws {LogError} when the directive is malformed or repeated.
 */
export function policyDirective(line, words, policy) {
  if (words[0] === 'limit') {
    if (words.length !== 3) throw new LogError(line, 'expected limit <starts> <window>')
    if (policy.limit !== undefined) throw new LogError(line, 'limit is declared twice')
    policy.limit = { starts: positive(line, 'starts', words[1]), window: positive(line, 'window', words[2]) }
    return true
  }
  if (words[0] === 'retry') {
    if (words.length !== 3) throw new LogError(line, 'expected retry <max> <base>')
    if (policy.retry !== undefined) throw new LogError(line, 'retry is declared twice')
    policy.retry = { max: positive(line, 'max', words[1]), base: count(line, 'base', words[2]) }
    return true
  }
  return false
}

/**
 * Parse the job log.
 * @param {string[]} lines - the input lines.
 * @param {{limit?: {starts: number, window: number}, retry?: {max: number, base: number}}} policy - the policy the command line already set, edited in place.
 * @returns {{jobs: Map<string, {id: string, duration: number, outcomes: string[]}>, submissions: {id: string, at: number}[]}} the declared jobs and the submissions in input order.
 * @throws {LogError} on the first line the grammar refuses.
 */
export function parse(lines, policy) {
  throw new Error('not implemented')
}
