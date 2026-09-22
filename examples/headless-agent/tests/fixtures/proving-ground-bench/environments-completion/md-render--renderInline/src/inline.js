/** Inline rendering: escapes, code spans, emphasis, and the three link forms. */

import { escapeAttribute, escapeText } from './html.js'
import { normalizeLabel } from './refs.js'

const ESCAPABLE = '\\`*[]()'

/** The index of the first `]` that no backslash escapes, or -1. */
function closingBracket(text, from) {
  for (let index = from; index < text.length; index += 1) {
    if (text[index] === '\\') {
      index += 1
      continue
    }
    if (text[index] === ']') return index
  }
  return -1
}

/** One link starting at `[`, or undefined when nothing there is a link. */
function readLink(text, start, definitions) {
  const close = closingBracket(text, start + 1)
  if (close === -1) return undefined
  const inner = text.slice(start + 1, close)
  if (text[close + 1] === '(') {
    const end = text.indexOf(')', close + 2)
    if (end === -1) return undefined
    return { url: text.slice(close + 2, end).trim(), inner, next: end + 1 }
  }
  if (text[close + 1] === '[') {
    const end = closingBracket(text, close + 2)
    if (end === -1) return undefined
    const written = text.slice(close + 2, end)
    const label = normalizeLabel(written === '' ? inner : written)
    const found = definitions.get(label)
    if (found === undefined) return undefined
    return { url: found.url, inner, next: end + 1 }
  }
  return undefined
}

/**
 * Render one run of inline Markdown.
 * @param {string} text - the raw inline text.
 * @param {Map<string, {url: string, source: string}>} definitions - the link definitions in force.
 * @returns {string} the HTML.
 */
export function renderInline(text, definitions) {
  throw new Error('not implemented')
}
