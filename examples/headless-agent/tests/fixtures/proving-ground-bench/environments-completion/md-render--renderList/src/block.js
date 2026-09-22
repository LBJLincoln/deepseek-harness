/** Block parsing: fences, headings, nested lists, paragraphs, and the definitions a document carries. */

import { escapeText } from './html.js'
import { renderInline } from './inline.js'
import { define, readDefinition } from './refs.js'

const FENCE = /^(`{3,})([^`]*)$/
const HEADING = /^(#{1,6}) (.*)$/
const ITEM = /^( *)- (.*)$/

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
 * The blocks of one document, with its own definitions added to `definitions`.
 * @param {string[]} lines - the document's lines.
 * @param {Map<string, {url: string, source: string}>} definitions - the definitions already in force, extended in place.
 * @returns {{kind: string, level?: number, text?: string, lines?: string[], items?: object[], info?: string, content?: string[]}[]} the blocks in document order.
 * @throws {BlockError} on an unterminated fence.
 * @throws {import('./refs.js').RefError} on a label the document defines twice.
 */
export function parse(lines, definitions) {
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
    const definition = readDefinition(raw)
    if (definition !== undefined) {
      flush()
      define(definitions, line, definition, 'document')
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
      const depth = Math.min(Math.floor(item[1].length / 2), items.length === 0 ? 0 : deepest(items) + 1)
      push(items, depth, item[2].trim())
      continue
    }
    if (items !== undefined) flush()
    paragraph.push(raw.trim())
  }
  flush()
  return out
}

/** The depth of the item the next one may nest under. */
function deepest(items) {
  const last = items[items.length - 1]
  return last.children.length === 0 ? 0 : 1 + deepest(last.children)
}

/** Add one item at `depth`, walking down the last item of each level above it. */
function push(items, depth, text) {
  if (depth === 0) {
    items.push({ text, children: [] })
    return
  }
  push(items[items.length - 1].children, depth - 1, text)
}

/** One list, rendered with its nested lists inside their parent item. */
function renderList(items, definitions) {
  throw new Error('not implemented')
}

/**
 * Render parsed blocks to HTML.
 * @param {readonly object[]} parsed - the document's blocks.
 * @param {Map<string, {url: string, source: string}>} definitions - the definitions in force.
 * @returns {string} the HTML, with a trailing newline unless the document holds no block.
 */
export function render(parsed, definitions) {
  const rendered = parsed.map((block) => {
    if (block.kind === 'heading') return `<h${block.level}>${renderInline(block.text, definitions)}</h${block.level}>`
    if (block.kind === 'paragraph') return `<p>${block.lines.map(text => renderInline(text, definitions)).join('\n')}</p>`
    if (block.kind === 'list') return renderList(block.items, definitions)
    const open = block.info === '' ? '<pre><code>' : `<pre><code class="language-${escapeText(block.info)}">`
    return `${open}${block.content.map(text => `${escapeText(text)}\n`).join('')}</code></pre>`
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
