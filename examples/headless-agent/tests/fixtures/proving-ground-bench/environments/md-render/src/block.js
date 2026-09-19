/** Block parsing: fences, headings, flat lists, and paragraphs. */

import { renderInline } from './inline.js'

const FENCE = /^(`{3,})([^`]*)$/
const HEADING = /^(#{1,6}) (.*)$/
const ITEM = /^- (.*)$/

/** One refusal of a document line, carrying the 1-based line it was read at. */
export class BlockError extends Error {
  /**
   * @param {number} line - the 1-based input line.
   * @param {string} message - the message the specification words, without the position.
   */
  constructor(line, message) {
    super(message)
    this.name = 'BlockError'
    this.line = line
  }
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
 * The blocks of one document.
 * @param {string[]} lines - the document's lines.
 * @returns {{kind: string, level?: number, text?: string, lines?: string[], items?: string[], info?: string, content?: string[]}[]} the blocks in document order.
 * @throws {BlockError} on an unterminated fence.
 */
export function parse(lines) {
  const out = []
  let paragraph = []
  let items
  const flush = () => {
    if (paragraph.length > 0) {
      out.push({ kind: 'paragraph', lines: paragraph })
      paragraph = []
    }
    if (items !== undefined) {
      out.push({ kind: 'list', items })
      items = undefined
    }
  }
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]
    const line = index + 1
    const fence = FENCE.exec(raw)
    if (fence !== null) {
      flush()
      const content = []
      let close = -1
      for (let scan = index + 1; scan < lines.length; scan += 1) {
        const candidate = lines[scan].trim()
        if (/^`{3,}$/u.test(candidate) && candidate.length >= fence[1].length) {
          close = scan
          break
        }
        content.push(lines[scan])
      }
      if (close === -1) throw new BlockError(line, 'unterminated code fence')
      out.push({ kind: 'fence', info: fence[2].trim().split(/\s+/u)[0], content })
      index = close
      continue
    }
    if (raw.trim() === '') {
      flush()
      continue
    }
    const heading = HEADING.exec(raw)
    if (heading !== null) {
      flush()
      out.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() })
      continue
    }
    const item = ITEM.exec(raw)
    if (item !== null && paragraph.length === 0) {
      if (items === undefined) items = []
      items.push(item[1].trim())
      continue
    }
    if (items !== undefined) flush()
    paragraph.push(raw.trim())
  }
  flush()
  return out
}

/**
 * Render parsed blocks to HTML.
 * @param {readonly object[]} parsed - the document's blocks.
 * @returns {string} the HTML, with a trailing newline unless the document holds no block.
 */
export function render(parsed) {
  const rendered = parsed.map((block) => {
    if (block.kind === 'heading') return `<h${block.level}>${renderInline(block.text)}</h${block.level}>`
    if (block.kind === 'paragraph') return `<p>${block.lines.map(text => renderInline(text)).join('\n')}</p>`
    if (block.kind === 'list') return ['<ul>', ...block.items.map(text => `<li>${renderInline(text)}</li>`), '</ul>'].join('\n')
    const open = block.info === '' ? '<pre><code>' : `<pre><code class="language-${block.info}">`
    return `${open}${block.content.map(text => `${text}\n`).join('')}</code></pre>`
  })
  return rendered.length === 0 ? '' : `${rendered.join('\n')}\n`
}

/**
 * The headings of parsed blocks, for the outline.
 * @param {readonly object[]} parsed - the document's blocks.
 * @returns {{level: number, text: string}[]} the headings in document order.
 */
export function headings(parsed) {
  return parsed.filter(block => block.kind === 'heading').map(block => ({ level: block.level, text: block.text }))
}
