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
  throw new Error('not implemented')
}

/**
 * Parse the job log.
 * @param {string[]} lines - the input lines.
 * @param {{limit?: {starts: number, window: number}, retry?: {max: number, base: number}}} policy - the policy the command line already set, edited in place.
 * @returns {{jobs: Map<string, {id: string, duration: number, outcomes: string[]}>, submissions: {id: string, at: number}[]}} the declared jobs and the submissions in input order.
 * @throws {LogError} on the first line the grammar refuses.
 */
export function parse(lines, policy) {
  const jobs = new Map()
  const submissions = []
  const submitted = new Map()
  for (const [index, raw] of lines.entries()) {
    const line = index + 1
    const text = raw.trim()
    if (text === '' || text.startsWith('#')) continue
    const words = text.split(/\s+/u)
    if (policyDirective(line, words, policy)) continue
    if (words[0] === 'job') {
      if (words.length < 4) throw new LogError(line, 'expected job <id> <duration> <outcome>...')
      const id = words[1]
      if (!ID.test(id)) throw new LogError(line, `invalid job id ${id}`)
      if (jobs.has(id)) throw new LogError(line, `job ${id} is declared twice`)
      const duration = count(line, 'duration', words[2])
      for (const outcome of words.slice(3)) {
        if (outcome !== 'ok' && outcome !== 'fail') throw new LogError(line, `invalid outcome ${outcome}`)
      }
      jobs.set(id, { id, duration, outcomes: words.slice(3) })
    } else if (words[0] === 'submit') {
      if (words.length !== 3) throw new LogError(line, 'expected submit <at> <id>')
      const at = count(line, 'at', words[1])
      const id = words[2]
      if (!ID.test(id)) throw new LogError(line, `invalid job id ${id}`)
      if (submitted.has(id)) throw new LogError(line, `job ${id} is submitted twice`)
      submitted.set(id, line)
      submissions.push({ id, at })
    } else {
      throw new LogError(line, `unknown directive ${words[0]}`)
    }
  }
  for (const { id } of submissions) {
    if (!jobs.has(id)) throw new LogError(0, `unknown job ${id}`)
  }
  return { jobs, submissions }
}
