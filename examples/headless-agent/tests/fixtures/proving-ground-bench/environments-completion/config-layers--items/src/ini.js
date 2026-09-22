/** The INI reader: dotted keys, the raw text of each value, and where that text sits. */

const NAME = /^[A-Za-z0-9_.-]+$/

/** One refusal of an INI line, carrying the 1-based line and column it was read at. */
export class IniError extends Error {
  /**
   * @param {number} line - the 1-based input line.
   * @param {number} column - the 1-based column of the raw line.
   * @param {string} message - the message the specification words, without the position.
   */
  constructor(line, column, message) {
    super(message)
    this.name = 'IniError'
    this.line = line
    this.column = column
  }
}

/** The 1-based column of the first non-space character of `raw`. */
function indent(raw) {
  return raw.length - raw.trimStart().length + 1
}

/**
 * Parse INI text into its settings.
 * @param {string} text - the file's whole text.
 * @returns {Map<string, {text: string, line: number, column: number}>} each dotted key's raw value and position, in the order the file writes them.
 * @throws {IniError} on the first line the grammar refuses.
 */
export function parse(text) {
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const values = new Map()
  let section = ''
  for (const [index, raw] of lines.entries()) {
    const line = index + 1
    const trimmed = raw.trim()
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith(';')) continue
    if (trimmed.startsWith('[')) {
      if (!trimmed.endsWith(']')) throw new IniError(line, raw.trimEnd().length + 1, 'expected "]"')
      const name = trimmed.slice(1, -1)
      if (name === '') throw new IniError(line, indent(raw) + 1, 'expected a section name')
      if (!NAME.test(name)) throw new IniError(line, indent(raw) + 1, `invalid section name ${name}`)
      section = name
      continue
    }
    const split = trimmed.indexOf('=')
    if (split === -1) throw new IniError(line, indent(raw), 'expected a section header or key = value')
    const key = trimmed.slice(0, split).trim()
    if (key === '') throw new IniError(line, indent(raw) + split, 'expected a key')
    if (!NAME.test(key)) throw new IniError(line, indent(raw), `invalid key ${key}`)
    const full = section === '' ? key : `${section}.${key}`
    if (values.has(full)) throw new IniError(line, indent(raw), `key ${full} is set twice`)
    const after = raw.indexOf('=', indent(raw) - 1) + 1
    const rest = raw.slice(after)
    const column = rest.trim() === '' ? raw.trimEnd().length + 1 : after + (rest.length - rest.trimStart().length) + 1
    values.set(full, { text: rest.trim(), line, column })
  }
  return values
}
