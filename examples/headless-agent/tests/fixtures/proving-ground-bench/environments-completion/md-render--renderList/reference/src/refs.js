/** Link definitions: how a label is written down, normalized, and looked up. */

const DEFINITION = /^\[([^\]]+)\]:\s+(\S.*)$/

/** One refusal of a definition, carrying the 1-based line it was read at. */
export class RefError extends Error {
  /**
   * @param {number} line - the 1-based input line.
   * @param {string} message - the message the specification words, without the position.
   */
  constructor(line, message) {
    super(message)
    this.name = 'RefError'
    this.line = line
  }
}

/**
 * One label in its comparable form: trimmed, whitespace runs collapsed, lowercased.
 * @param {string} label - the label as it was written.
 * @returns {string} the normalized label.
 */
export function normalizeLabel(label) {
  return label.trim().replace(/\s+/gu, ' ').toLowerCase()
}

/**
 * Read one line as a definition.
 * @param {string} raw - the line as written.
 * @returns {{label: string, url: string} | undefined} the definition, or undefined when the line is not one.
 */
export function readDefinition(raw) {
  const match = DEFINITION.exec(raw.trim())
  if (match === null) return undefined
  return { label: normalizeLabel(match[1]), url: match[2].trim() }
}

/**
 * Add one definition to a table, refusing a label it already holds.
 * @param {Map<string, {url: string, source: string}>} table - the definitions so far.
 * @param {number} line - the 1-based line the definition was read at.
 * @param {{label: string, url: string}} definition - the definition to add.
 * @param {string} source - the layer it came from.
 * @throws {RefError} when the label is already defined.
 */
export function define(table, line, definition, source) {
  if (table.has(definition.label)) throw new RefError(line, `label ${definition.label} is defined twice`)
  table.set(definition.label, { url: definition.url, source })
}
