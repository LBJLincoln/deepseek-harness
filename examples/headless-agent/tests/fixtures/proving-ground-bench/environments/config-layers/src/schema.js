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
