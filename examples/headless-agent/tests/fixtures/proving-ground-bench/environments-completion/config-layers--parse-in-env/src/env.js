/** The environment layer: `NAME=VALUE` lines read from standard input. */

/** One refusal of an environment line, carrying the 1-based line and column. */
export class EnvError extends Error {
  /**
   * @param {number} line - the 1-based input line.
   * @param {number} column - the 1-based column of the raw line.
   * @param {string} message - the message the specification words, without the position.
   */
  constructor(line, column, message) {
    super(message)
    this.name = 'EnvError'
    this.line = line
    this.column = column
  }
}

/** The 1-based column of the first non-space character of `raw`. */
function indent(raw) {
  return raw.length - raw.trimStart().length + 1
}

/**
 * The variable name one setting key travels under.
 * @param {string} key - the dotted setting key.
 * @returns {string} the variable name.
 */
export function variableName(key) {
  return `CONF_${key.toUpperCase().replaceAll('.', '_')}`
}

/**
 * Parse the environment layer.
 * @param {string} text - everything standard input carried.
 * @param {readonly {key: string}[]} settings - the schema, which decides which names are known.
 * @returns {Map<string, {text: string, line: number, column: number}>} each dotted key's raw value and position, in the order the input writes them.
 * @throws {EnvError} on the first line the grammar refuses.
 */
export function parse(text, settings) {
  throw new Error('not implemented')
}
