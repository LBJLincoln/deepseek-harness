/** The task-file parser: directives to tasks, with the failures the specification words. */

const NAME = /^[A-Za-z0-9_.-]+$/

/** One refusal of an input line, carrying the 1-based line it was read from, or 0 when it names none. */
export class ParseError extends Error {
  /**
   * @param {number} line - the 1-based input line, or 0 when the failure names no line.
   * @param {string} message - the message the specification words, without the `error: ` prefix.
   */
  constructor(line, message) {
    super(message)
    this.name = 'ParseError'
    this.line = line
  }
}

/** Whether a word is a usable task name. */
function isName(word) {
  return NAME.test(word)
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

/**
 * Parse a task file into its tasks.
 * @param {string[]} lines - the input lines.
 * @returns {Map<string, {name: string, command: string, needs: string[]}>} the tasks by name, in declaration order.
 */
export function parse(lines) {
  const tasks = new Map()
  const referenced = []
  const attachments = []
  for (const [index, raw] of lines.entries()) {
    const line = index + 1
    const text = raw.trim()
    if (text === '' || text.startsWith('#')) continue
    const words = text.split(/\s+/u)
    if (words[0] === 'task') {
      if (words.length < 3) throw new ParseError(line, 'expected task <name> <word>...')
      const name = words[1]
      if (!isName(name)) throw new ParseError(line, `invalid task name ${name}`)
      if (tasks.has(name)) throw new ParseError(line, `task ${name} is declared twice`)
      tasks.set(name, { name, command: words.slice(2).join(' '), needs: [] })
    } else if (words[0] === 'needs') {
      if (words.length < 3) throw new ParseError(line, 'expected needs <name> <dependency>...')
      const [, name, ...values] = words
      if (!isName(name)) throw new ParseError(line, `invalid task name ${name}`)
      referenced.push(name)
      for (const value of values) {
        if (!isName(value)) throw new ParseError(line, `invalid task name ${value}`)
        referenced.push(value)
      }
      attachments.push({ name, values })
    } else {
      throw new ParseError(line, `unknown directive ${words[0]}`)
    }
  }
  for (const name of referenced) {
    if (!tasks.has(name)) throw new ParseError(0, `unknown task ${name}`)
  }
  for (const { name, values } of attachments) {
    const list = tasks.get(name).needs
    for (const value of values) {
      if (!list.includes(value)) list.push(value)
    }
  }
  return tasks
}
