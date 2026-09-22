/** The settings this loader knows, their types, and the text each one defaults to. */

/** Every known setting, in ascending key order. */
export const SETTINGS = [
  { key: 'log.file', type: 'string', default: '' },
  { key: 'log.level', type: 'enum', members: ['debug', 'info', 'warn', 'error'], default: 'info' },
  { key: 'log.rotate', type: 'boolean', default: 'true' },
  { key: 'retry.attempts', type: 'integer', default: '3' },
  { key: 'retry.backoff', type: 'duration', default: '250ms' },
  { key: 'server.host', type: 'string', default: 'localhost' },
  { key: 'server.port', type: 'integer', default: '8080' },
  { key: 'server.timeout', type: 'duration', default: '30s' },
  { key: 'server.tls', type: 'boolean', default: 'false' },
  { key: 'tags', type: 'list', default: '' },
]

const BY_KEY = new Map(SETTINGS.map(declared => [declared.key, declared]))

/**
 * The setting one key names, or undefined when the schema does not know it.
 * @param {string} key - the dotted setting key.
 * @returns {{key: string, type: string, members?: string[], default: string} | undefined} the setting.
 */
export function setting(key) {
  return BY_KEY.get(key)
}

const INTEGER = /^-?(?:0|[1-9][0-9]*)$/
const DURATION = /^([0-9]+)(ms|s|m|h)$/
const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }

/** One value the schema refuses, worded without the position the caller adds. */
export class ValueError extends Error {
  /**
   * @param {string} message - the message the specification words, without the position.
   */
  constructor(message) {
    super(message)
    this.name = 'ValueError'
  }
}

/** The items of a list value, trimmed, first occurrence kept. */
function items(declared, text) {
  throw new Error('not implemented')
}

/**
 * Coerce one setting's text and render it the way `load` prints it.
 * @param {{key: string, type: string, members?: string[]}} declared - the setting the text belongs to.
 * @param {string} text - the raw text the winning layer wrote.
 * @returns {string} the canonical rendering.
 * @throws {ValueError} when the text does not fit the declared type.
 */
export function coerce(declared, text) {
  switch (declared.type) {
    case 'integer':
      if (!INTEGER.test(text)) throw new ValueError(`${declared.key} is not an integer: ${text}`)
      return text
    case 'boolean':
      if (text !== 'true' && text !== 'false') throw new ValueError(`${declared.key} is not a boolean: ${text}`)
      return text
    case 'enum':
      if (!declared.members.includes(text)) {
        throw new ValueError(`${declared.key} is not one of ${declared.members.join('|')}: ${text}`)
      }
      return text
    case 'duration': {
      const match = DURATION.exec(text)
      if (match === null) throw new ValueError(`${declared.key} is not a duration: ${text}`)
      return String(Number(match[1]) * UNIT_MS[match[2]])
    }
    case 'list':
      return items(declared, text).join(',')
    default:
      return text
  }
}
