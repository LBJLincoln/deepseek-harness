/** Segment-wise glob matching: wildcards, bracket classes, extglob groups, and `**`. */

import { GlobError } from './error.js'

/** The extglob prefixes, each followed immediately by `(`. */
const EXTGLOB = new Set(['?', '*', '+', '@', '!'])

/**
 * Parse one pattern segment into nodes. Parsing stops at the segment's end, or
 * at the unescaped `)` or `|` that ends an extglob alternative.
 * @param text - the whole pattern segment.
 * @param start - where this parse begins.
 * @param nested - whether the parse may stop at `|` or `)`.
 * @returns the nodes and the index just past what was consumed.
 * @throws {GlobError} for a trailing backslash, an unterminated bracket, or an unterminated extglob.
 */
function parseNodes(text, start, nested) {
  const nodes = []
  let index = start
  while (index < text.length) {
    const character = text[index]
    if (nested && (character === ')' || character === '|')) return { nodes, index }
    if (character === '\\') {
      if (index + 1 >= text.length) throw new GlobError('trailing backslash in pattern')
      nodes.push({ type: 'literal', character: text[index + 1] })
      index += 2
      continue
    }
    if (EXTGLOB.has(character) && text[index + 1] === '(') {
      const group = parseExtglob(text, index + 2)
      nodes.push({ type: 'extglob', operator: character, alternatives: group.alternatives })
      index = group.index
      continue
    }
    if (character === '?') {
      nodes.push({ type: 'one' })
      index += 1
      continue
    }
    if (character === '*') {
      nodes.push({ type: 'many' })
      while (text[index] === '*') index += 1
      continue
    }
    if (character === '[') {
      const bracket = parseBracket(text, index + 1)
      nodes.push(bracket.node)
      index = bracket.index
      continue
    }
    nodes.push({ type: 'literal', character })
    index += 1
  }
  if (nested) throw new GlobError('unterminated extglob in pattern')
  return { nodes, index }
}

/** Parse the `|`-separated alternatives of an extglob, starting just after its `(`. */
function parseExtglob(text, start) {
  const alternatives = []
  let index = start
  for (;;) {
    const parsed = parseNodes(text, index, true)
    alternatives.push(parsed.nodes)
    index = parsed.index
    if (text[index] === '|') {
      index += 1
      continue
    }
    return { alternatives, index: index + 1 }
  }
}

/** Parse a bracket class, starting just after its `[`. */
function parseBracket(text, start) {
  let index = start
  const negated = text[index] === '!' || text[index] === '^'
  if (negated) index += 1
  const items = []
  let first = true
  while (index < text.length) {
    if (text[index] === ']' && !first) return { node: { type: 'class', negated, items }, index: index + 1 }
    first = false
    let character = text[index]
    if (character === '\\') {
      if (index + 1 >= text.length) throw new GlobError('trailing backslash in pattern')
      character = text[index + 1]
      index += 1
    }
    index += 1
    if (text[index] === '-' && text[index + 1] !== undefined && text[index + 1] !== ']') {
      let upper = text[index + 1]
      index += 2
      if (upper === '\\') {
        if (index >= text.length) throw new GlobError('trailing backslash in pattern')
        upper = text[index]
        index += 1
      }
      items.push({ from: character, to: upper })
      continue
    }
    items.push({ from: character, to: character })
  }
  throw new GlobError('unterminated bracket in pattern')
}

/** Whether one character falls in a bracket class, honouring its negation. */
function inClass(node, character) {
  const code = character.codePointAt(0)
  const hit = node.items.some(item => code >= item.from.codePointAt(0) && code <= item.to.codePointAt(0))
  return node.negated ? !hit : hit
}

/** Whether `nodes` matches the whole of `text`, from node `at` and character `from`. */
function matchFrom(nodes, at, text, from) {
  if (at === nodes.length) return from === text.length
  const node = nodes[at]
  switch (node.type) {
    case 'literal':
      return text[from] === node.character && matchFrom(nodes, at + 1, text, from + 1)
    case 'one':
      return from < text.length && matchFrom(nodes, at + 1, text, from + 1)
    case 'many':
      for (let end = from; end <= text.length; end += 1) {
        if (matchFrom(nodes, at + 1, text, end)) return true
      }
      return false
    case 'class':
      return from < text.length && inClass(node, text[from]) && matchFrom(nodes, at + 1, text, from + 1)
    default:
      return matchExtglob(nodes, at, text, from)
  }
}

/** Whether some alternative of an extglob matches exactly `text.slice(from, end)`. */
function someAlternative(node, text, from, end) {
  const slice = text.slice(from, end)
  return node.alternatives.some(alternative => matchFrom(alternative, 0, slice, 0))
}

/** The five extglob operators, each deciding how much of the text the group consumes. */
function matchExtglob(nodes, at, text, from) {
  const node = nodes[at]
  const rest = end => matchFrom(nodes, at + 1, text, end)
  if (node.operator === '!') {
    for (let end = from; end <= text.length; end += 1) {
      if (!someAlternative(node, text, from, end) && rest(end)) return true
    }
    return false
  }
  if (node.operator === '@' || node.operator === '?') {
    if (node.operator === '?' && rest(from)) return true
    for (let end = from; end <= text.length; end += 1) {
      if (someAlternative(node, text, from, end) && rest(end)) return true
    }
    return false
  }
  // `*` may consume nothing; `+` must consume one repetition before the rest.
  if (node.operator === '*' && rest(from)) return true
  for (let end = from + 1; end <= text.length; end += 1) {
    if (!someAlternative(node, text, from, end)) continue
    if (rest(end) || matchExtglob(nodes, at, text, end)) return true
  }
  return false
}

/**
 * Whether one pattern segment matches one path segment. A path segment that
 * begins with `.` matches only a segment whose first node is a literal `.`.
 * @param nodes - the parsed pattern segment.
 * @param segment - the path segment.
 * @returns whether the two agree.
 */
function matchSegment(nodes, segment) {
  if (segment.startsWith('.') && !(nodes[0]?.type === 'literal' && nodes[0].character === '.')) return false
  return matchFrom(nodes, 0, segment, 0)
}

/** Whether the pattern's segments from `at` match the path's segments from `from`. */
function matchSegments(pattern, at, path, from) {
  if (at === pattern.length) return from === path.length
  if (pattern[at] === null) {
    if (matchSegments(pattern, at + 1, path, from)) return true
    for (let end = from; end < path.length; end += 1) {
      if (path[end].startsWith('.')) return false
      if (matchSegments(pattern, at + 1, path, end + 1)) return true
    }
    return false
  }
  if (from >= path.length) return false
  if (!matchSegment(pattern[at], path[from])) return false
  return matchSegments(pattern, at + 1, path, from + 1)
}

/** Split a pattern on the `/` characters that are not escaped. */
function splitPattern(pattern) {
  const segments = []
  let current = ''
  for (let index = 0; index < pattern.length; index += 1) {
    if (pattern[index] === '\\' && index + 1 < pattern.length) {
      current += pattern.slice(index, index + 2)
      index += 1
      continue
    }
    if (pattern[index] === '/') {
      segments.push(current)
      current = ''
      continue
    }
    current += pattern[index]
  }
  segments.push(current)
  return segments
}

/**
 * Compile one brace-free pattern into a matcher over paths.
 * @param pattern - the pattern, already brace-expanded.
 * @returns a predicate over path text.
 * @throws {GlobError} when the pattern is malformed.
 */
export function compile(pattern) {
  const segments = splitPattern(pattern).map(segment => (segment === '**' ? null : parseNodes(segment, 0, false).nodes))
  return path => matchSegments(segments, 0, path.split('/'), 0)
}
