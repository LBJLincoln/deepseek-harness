/** Inline rendering: escapes, code spans, emphasis, and inline links. */

import { escapeAttribute, escapeText } from './html.js'

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
function readLink(text, start) {
  const close = closingBracket(text, start + 1)
  if (close === -1) return undefined
  const inner = text.slice(start + 1, close)
  if (text[close + 1] !== '(') return undefined
  const end = text.indexOf(')', close + 2)
  if (end === -1) return undefined
  return { url: text.slice(close + 2, end).trim(), inner, next: end + 1 }
}

/**
 * Render one run of inline Markdown.
 * @param {string} text - the raw inline text.
 * @returns {string} the HTML.
 */
export function renderInline(text) {
  let out = ''
  let index = 0
  while (index < text.length) {
    const character = text[index]
    if (character === '\\' && index + 1 < text.length && ESCAPABLE.includes(text[index + 1])) {
      out += escapeText(text[index + 1])
      index += 2
      continue
    }
    if (character === '`') {
      const end = text.indexOf('`', index + 1)
      if (end !== -1) {
        out += `<code>${escapeText(text.slice(index + 1, end))}</code>`
        index = end + 1
        continue
      }
    }
    if (text.startsWith('**', index)) {
      const end = text.indexOf('**', index + 2)
      if (end !== -1) {
        out += `<strong>${renderInline(text.slice(index + 2, end))}</strong>`
        index = end + 2
        continue
      }
    }
    if (character === '*') {
      const end = text.indexOf('*', index + 1)
      if (end !== -1) {
        out += `<em>${renderInline(text.slice(index + 1, end))}</em>`
        index = end + 1
        continue
      }
    }
    if (character === '[') {
      const link = readLink(text, index)
      if (link !== undefined) {
        out += `<a href="${escapeAttribute(link.url)}">${renderInline(link.inner)}</a>`
        index = link.next
        continue
      }
    }
    out += escapeText(character)
    index += 1
  }
  return out
}
