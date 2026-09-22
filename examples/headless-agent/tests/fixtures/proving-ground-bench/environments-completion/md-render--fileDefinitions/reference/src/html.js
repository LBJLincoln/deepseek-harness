/** Turning text into HTML that says what it meant. */

/**
 * Escape text for an element's content.
 * @param {string} text - the text to escape.
 * @returns {string} the escaped text.
 */
export function escapeText(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * Escape text for a double-quoted attribute value.
 * @param {string} text - the text to escape.
 * @returns {string} the escaped text.
 */
export function escapeAttribute(text) {
  return escapeText(text).replaceAll('"', '&quot;')
}
