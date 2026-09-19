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
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const byName = new Map(settings.map(declared => [variableName(declared.key), declared.key]))
  const values = new Map()
  for (const [index, raw] of lines.entries()) {
    const line = index + 1
    const trimmed = raw.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const split = trimmed.indexOf('=')
    if (split === -1) throw new EnvError(line, indent(raw), 'expected NAME=VALUE')
    const name = trimmed.slice(0, split).trim()
    if (name === '') throw new EnvError(line, indent(raw), 'expected a variable name')
    const key = byName.get(name)
    if (key === undefined) throw new EnvError(line, indent(raw), `unknown environment variable ${name}`)
    if (values.has(key)) throw new EnvError(line, indent(raw), `${name} is set twice`)
    const after = indent(raw) + split
    const rest = raw.slice(after)
    const column = rest.trim() === '' ? raw.trimEnd().length + 1 : after + (rest.length - rest.trimStart().length) + 1
    values.set(key, { text: rest.trim(), line, column })
  }
  return values
}
