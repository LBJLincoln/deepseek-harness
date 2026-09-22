/** Brace expansion: alternative lists, integer ranges, and letter ranges, leftmost group first. */

import { GlobError } from './error.js'

/** `A..B` or `A..B..S` over integers, with the endpoint text kept for zero padding. */
const INTEGER_RANGE = /^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/u

/** `a..e` or `a..e..2` over single ASCII letters. */
const LETTER_RANGE = /^([A-Za-z])\.\.([A-Za-z])(?:\.\.(-?\d+))?$/u

/** How many values one range may produce, so a typed range cannot exhaust memory. */
const RANGE_LIMIT = 1000

/**
 * The index of the `}` closing the `{` at `open`, counting nested braces and
 * skipping escaped characters.
 * @param text - the pattern.
 * @param open - the index of the opening brace.
 * @returns the index of the matching brace, or -1 when there is none.
 */
function closingBrace(text, open) {
  let depth = 0
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '\\') {
      index += 1
      continue
    }
    if (text[index] === '{') depth += 1
    else if (text[index] === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

/**
 * Split one brace body on the commas that sit at its own nesting depth.
 * @param body - the text between the braces.
 * @returns the alternatives, or `undefined` when the body holds no such comma.
 */
function alternatives(body) {
  const parts = []
  let depth = 0
  let start = 0
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] === '\\') {
      index += 1
      continue
    }
    if (body[index] === '{') depth += 1
    else if (body[index] === '}') depth -= 1
    else if (body[index] === ',' && depth === 0) {
      parts.push(body.slice(start, index))
      start = index + 1
    }
  }
  if (parts.length === 0) return undefined
  parts.push(body.slice(start))
  return parts
}

/** The values a numeric or letter range writes, or `undefined` when the body is not a range. */
function range(body) {
  throw new Error('not implemented')
}

/**
 * Expand every brace group of one pattern, leftmost group first, so the results
 * come out in the order the leftmost group's alternatives are written.
 * @param pattern - the pattern before expansion.
 * @returns every expansion, in order, with duplicates kept.
 * @throws {GlobError} when a range would produce more values than the limit allows.
 */
export function expandBraces(pattern) {
  let search = 0
  while (search < pattern.length) {
    if (pattern[search] === '\\') {
      search += 2
      continue
    }
    if (pattern[search] !== '{') {
      search += 1
      continue
    }
    const close = closingBrace(pattern, search)
    if (close === -1) {
      search += 1
      continue
    }
    const body = pattern.slice(search + 1, close)
    const parts = alternatives(body) ?? range(body)
    if (parts === undefined) {
      // A group with neither a comma nor a range is literal text; the next
      // group after its opening brace is still a candidate.
      search += 1
      continue
    }
    const prefix = pattern.slice(0, search)
    const suffix = pattern.slice(close + 1)
    return parts.flatMap(part => expandBraces(`${prefix}${part}${suffix}`))
  }
  return [pattern]
}
