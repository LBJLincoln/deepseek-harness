/** Paragraph splitting, greedy line breaking with hyphenation points, and justification. */

import { SOFT_HYPHEN, width } from './width.js'

/**
 * Split input lines into paragraphs of words. A line that holds only spaces and
 * tabs ends the current paragraph, and a run of such lines ends only one.
 * @param lines - the input lines, in order.
 * @returns one array of words per non-empty paragraph.
 */
export function paragraphs(lines) {
  const out = []
  let current = []
  for (const line of lines) {
    const words = line.split(/[ \t]+/u).filter(word => word !== '')
    if (words.length === 0) {
      if (current.length > 0) out.push(current)
      current = []
      continue
    }
    current.push(...words)
  }
  if (current.length > 0) out.push(current)
  return out
}

/**
 * The break points of one word: for each soft hyphen, the text before it with a
 * `-` appended and the text after it, both with the remaining soft hyphens kept
 * so a tail can break again.
 * @param word - the word, which may hold soft hyphens.
 * @returns the splits, from the earliest break point to the latest.
 */
function splits(word) {
  const out = []
  for (let index = 0; index < word.length; index += 1) {
    if (word[index] !== SOFT_HYPHEN) continue
    out.push({ head: `${word.slice(0, index)}-`, tail: word.slice(index + 1) })
  }
  return out
}

/** The soft hyphens a word carries are invisible once it is placed. */
function plain(word) {
  return word.replaceAll(SOFT_HYPHEN, '')
}

/**
 * Break one paragraph's words into lines of at most `limit` columns, filling
 * each line greedily and breaking a word at its latest usable hyphenation point
 * when the whole word does not fit.
 * @param words - the paragraph's words.
 * @param limit - the column limit, at least 1.
 * @returns the lines, each an array of placed words with their soft hyphens removed.
 */
export function breakLines(words, limit) {
  const lines = []
  let line = []
  let used = 0
  const queue = [...words]
  const flush = () => {
    if (line.length > 0) lines.push(line)
    line = []
    used = 0
  }
  while (queue.length > 0) {
    const word = queue.shift()
    const cost = width(word) + (line.length === 0 ? 0 : 1)
    if (used + cost <= limit) {
      line.push(plain(word))
      used += cost
      continue
    }
    const room = limit - used - (line.length === 0 ? 0 : 1)
    const usable = splits(word).filter(split => width(split.head) <= room).pop()
    if (usable !== undefined) {
      line.push(plain(usable.head))
      queue.unshift(usable.tail)
      flush()
      continue
    }
    if (line.length === 0) {
      // The word does not fit even on an empty line and offers no usable break,
      // so it takes a line of its own and overflows it.
      line.push(plain(word))
      flush()
      continue
    }
    flush()
    queue.unshift(word)
  }
  flush()
  return lines
}

/**
 * Pad one line's gaps so it fills the limit exactly, giving the leftmost gaps
 * the extra column when the padding does not divide evenly.
 * @param line - the placed words.
 * @param limit - the column limit.
 * @returns the padded text.
 */
export function justifyLine(line, limit) {
  const gaps = line.length - 1
  const content = line.reduce((total, word) => total + width(word), 0)
  if (gaps === 0 || content + gaps >= limit) return line.join(' ')
  const extra = limit - content
  const base = Math.floor(extra / gaps)
  const remainder = extra % gaps
  let text = line[0]
  for (let index = 1; index < line.length; index += 1) {
    text += ' '.repeat(base + (index <= remainder ? 1 : 0)) + line[index]
  }
  return text
}
