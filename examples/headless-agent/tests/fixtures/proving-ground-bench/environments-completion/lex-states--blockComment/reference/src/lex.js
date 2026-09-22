/** The scanner: one state machine over code points, tracking line and tab-stopped column. */

/** Words the scanner reports as `keyword` rather than `ident`. */
const KEYWORDS = new Set(['let', 'if', 'else', 'while', 'return', 'true', 'false', 'null'])

/** Punctuation, longest first so `<=` wins over `<` and `=>` over `=`. */
const PUNCTUATION = [
  '==', '!=', '<=', '>=', '&&', '||', '->', '=>',
  '+', '-', '*', '/', '%', '=', '<', '>', '!', '(', ')', '{', '}', '[', ']', ',', ';', '.',
]

/** The single-character escapes a string may carry. */
const ESCAPES = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', 0: '\0' }

/** Columns a tab advances to: the next multiple of four, plus one. */
const TAB = 4

/** Raised for a scan failure; the position is where the program reports it. */
export class LexError extends Error {
  /**
   * @param message - the reported reason.
   * @param line - the 1-based line.
   * @param column - the 1-based column.
   */
  constructor(message, line, column) {
    super(message)
    this.name = 'LexError'
    this.line = line
    this.column = column
  }
}

/** Whether a code point may open an identifier. */
const startsWord = character => /[A-Za-z_]/u.test(character)

/** Whether a code point may continue an identifier. */
const inWord = character => /[A-Za-z0-9_]/u.test(character)

/** Whether a code point is a digit in the given radix. */
function isDigit(character, radix) {
  if (character === undefined) return false
  const value = Number.parseInt(character, radix)
  return Number.isInteger(value) && /^[0-9A-Fa-f]$/u.test(character)
}

/** The scanner's cursor: the source, the offset, and the position it stands at. */
class Cursor {
  /**
   * @param source - the whole input text.
   */
  constructor(source) {
    this.source = source
    this.at = 0
    this.line = 1
    this.column = 1
  }

  /** The character at the cursor, or `undefined` past the end. */
  peek(ahead = 0) {
    return this.source[this.at + ahead]
  }

  /** Consume one character, advancing the line or the column it sits on. */
  next() {
    const character = this.source[this.at]
    this.at += 1
    if (character === '\n') {
      this.line += 1
      this.column = 1
    } else if (character === '\t') this.column += TAB - ((this.column - 1) % TAB)
    else this.column += 1
    return character
  }
}

/** Scan one number literal, which the caller has confirmed starts at the cursor. */
function number(cursor) {
  const line = cursor.line
  const column = cursor.column
  const start = cursor.at
  const digits = radix => {
    let seen = false
    for (;;) {
      if (isDigit(cursor.peek(), radix)) {
        seen = true
        cursor.next()
        continue
      }
      if (cursor.peek() === '_' && seen && isDigit(cursor.peek(1), radix)) {
        cursor.next()
        continue
      }
      return seen
    }
  }
  const prefix = cursor.peek() === '0' ? cursor.peek(1) : undefined
  let ok
  if (prefix !== undefined && 'xXbBoO'.includes(prefix)) {
    cursor.next()
    cursor.next()
    ok = digits({ x: 16, b: 2, o: 8 }[prefix.toLowerCase()])
  } else {
    ok = digits(10)
    if (cursor.peek() === '.' && isDigit(cursor.peek(1), 10)) {
      cursor.next()
      digits(10)
    }
    if (ok && (cursor.peek() === 'e' || cursor.peek() === 'E')) {
      const sign = cursor.peek(1) === '+' || cursor.peek(1) === '-' ? 1 : 0
      if (isDigit(cursor.peek(1 + sign), 10)) {
        cursor.next()
        for (let step = 0; step < sign; step += 1) cursor.next()
        digits(10)
      }
    }
  }
  while (inWord(cursor.peek() ?? '')) {
    ok = false
    cursor.next()
  }
  const text = cursor.source.slice(start, cursor.at)
  if (!ok) throw new LexError(`invalid number ${text}`, line, column)
  return { kind: 'number', text, line, column }
}

/** Scan one quoted string, decoding its escapes; `raw` keeps every character as written. */
function string(cursor, raw) {
  const line = cursor.line
  const column = cursor.column
  if (raw) cursor.next()
  cursor.next()
  let value = ''
  for (;;) {
    const character = cursor.peek()
    if (character === undefined) throw new LexError('unterminated string', line, column)
    if (character === '"') {
      cursor.next()
      return { kind: raw ? 'rawstring' : 'string', text: value, line, column }
    }
    if (raw) {
      value += cursor.next()
      continue
    }
    if (character === '\n') throw new LexError('newline in string', cursor.line, cursor.column)
    if (character !== '\\') {
      value += cursor.next()
      continue
    }
    const escapeLine = cursor.line
    const escapeColumn = cursor.column
    cursor.next()
    const marker = cursor.peek()
    if (marker !== undefined && marker in ESCAPES) {
      cursor.next()
      value += ESCAPES[marker]
      continue
    }
    if (marker === 'x' && isDigit(cursor.peek(1), 16) && isDigit(cursor.peek(2), 16)) {
      cursor.next()
      value += String.fromCharCode(Number.parseInt(`${cursor.next()}${cursor.next()}`, 16))
      continue
    }
    if (marker === 'u' && cursor.peek(1) === '{') {
      let body = ''
      let ahead = 2
      while (isDigit(cursor.peek(ahead), 16)) {
        body += cursor.peek(ahead)
        ahead += 1
      }
      if (body !== '' && cursor.peek(ahead) === '}' && Number.parseInt(body, 16) <= 0x10FFFF) {
        for (let step = 0; step <= ahead; step += 1) cursor.next()
        value += String.fromCodePoint(Number.parseInt(body, 16))
        continue
      }
    }
    throw new LexError(`invalid escape \\${marker ?? ''}`, escapeLine, escapeColumn)
  }
}

/** Skip a nestable block comment, which the caller has confirmed starts at the cursor. */
function blockComment(cursor) {
  const line = cursor.line
  const column = cursor.column
  let depth = 0
  for (;;) {
    if (cursor.peek() === undefined) throw new LexError('unterminated block comment', line, column)
    if (cursor.peek() === '/' && cursor.peek(1) === '*') {
      cursor.next()
      cursor.next()
      depth += 1
      continue
    }
    if (cursor.peek() === '*' && cursor.peek(1) === '/') {
      cursor.next()
      cursor.next()
      depth -= 1
      if (depth === 0) return
      continue
    }
    cursor.next()
  }
}

/**
 * Scan the whole source into tokens.
 * @param source - the input text.
 * @returns the tokens, each with its kind, text, line and column.
 * @throws {LexError} at the first character the machine cannot accept.
 */
export function lex(source) {
  const cursor = new Cursor(source)
  const tokens = []
  while (cursor.peek() !== undefined) {
    const character = cursor.peek()
    if (character === ' ' || character === '\t' || character === '\n' || character === '\r') {
      cursor.next()
      continue
    }
    if (character === '/' && cursor.peek(1) === '/') {
      while (cursor.peek() !== undefined && cursor.peek() !== '\n') cursor.next()
      continue
    }
    if (character === '/' && cursor.peek(1) === '*') {
      blockComment(cursor)
      continue
    }
    if (character === 'r' && cursor.peek(1) === '"') {
      tokens.push(string(cursor, true))
      continue
    }
    if (character === '"') {
      tokens.push(string(cursor, false))
      continue
    }
    if (isDigit(character, 10)) {
      tokens.push(number(cursor))
      continue
    }
    if (startsWord(character)) {
      const line = cursor.line
      const column = cursor.column
      let text = ''
      while (inWord(cursor.peek() ?? '')) text += cursor.next()
      tokens.push({ kind: KEYWORDS.has(text) ? 'keyword' : 'ident', text, line, column })
      continue
    }
    const punctuation = PUNCTUATION.find(candidate => cursor.source.startsWith(candidate, cursor.at))
    if (punctuation === undefined) throw new LexError(`unexpected character ${character}`, cursor.line, cursor.column)
    const line = cursor.line
    const column = cursor.column
    for (let step = 0; step < punctuation.length; step += 1) cursor.next()
    tokens.push({ kind: 'punct', text: punctuation, line, column })
  }
  return tokens
}
