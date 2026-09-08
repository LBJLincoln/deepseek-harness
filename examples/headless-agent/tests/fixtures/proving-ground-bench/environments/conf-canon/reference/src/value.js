/** Names and values: the scalar forms, arrays, and inline tables of one line. */

/** Raised for input the specification rejects; `line` is filled in by the caller. */
export class ConfError extends Error {
  /**
   * @param message - the reported reason.
   */
  constructor(message) {
    super(message)
    this.name = 'ConfError'
  }
}

/** A bare name: letters, digits, underscore and dash. */
const BARE = /^[A-Za-z0-9_-]+$/u

/** An integer: an optional sign and digit runs joined by single underscores. */
const INTEGER = /^[+-]?[0-9]+(?:_[0-9]+)*$/u

/** A float: an integer part, then a fraction, an exponent, or both. */
const FLOAT = /^[+-]?[0-9]+(?:_[0-9]+)*(?:\.[0-9]+(?:_[0-9]+)*)?(?:[eE][+-]?[0-9]+(?:_[0-9]+)*)?$/u

/** The escapes a basic string carries. */
const ESCAPES = { '"': '"', '\\': '\\', n: '\n', t: '\t', r: '\r', 0: '\0' }

/** Join a path counted from the root with the name of something under it. */
function under(path, rest) {
  return path === '' ? rest : `${path}.${rest}`
}

/** A cursor over one line's text, shared by the name reader and the value reader. */
export class Reader {
  /**
   * @param text - the line, or the part of it still to read.
   */
  constructor(text) {
    this.text = text
    this.at = 0
  }

  /** Skip spaces and tabs. */
  skip() {
    while (this.text[this.at] === ' ' || this.text[this.at] === '\t') this.at += 1
  }

  /** The character at the cursor, or `undefined` past the end. */
  peek() {
    return this.text[this.at]
  }

  /** Consume the given text when it sits at the cursor. */
  eat(what) {
    if (!this.text.startsWith(what, this.at)) return false
    this.at += what.length
    return true
  }

  /** Read one quoted string, decoding a basic string's escapes. */
  string() {
    const quote = this.text[this.at]
    this.at += 1
    let value = ''
    for (;;) {
      const character = this.text[this.at]
      if (character === undefined) throw new ConfError('unterminated string')
      if (character === quote) {
        this.at += 1
        return value
      }
      if (quote === "'" || character !== '\\') {
        value += character
        this.at += 1
        continue
      }
      const marker = this.text[this.at + 1]
      if (marker !== undefined && marker in ESCAPES) {
        value += ESCAPES[marker]
        this.at += 2
        continue
      }
      if (marker === 'u' && /^[0-9A-Fa-f]{4}/u.test(this.text.slice(this.at + 2))) {
        value += String.fromCharCode(Number.parseInt(this.text.slice(this.at + 2, this.at + 6), 16))
        this.at += 6
        continue
      }
      throw new ConfError(`invalid escape \\${marker ?? ''}`)
    }
  }

  /**
   * Read one dotted name, whose parts are bare words or basic strings.
   * @returns the parts, in order.
   * @throws {ConfError} when a part is missing or malformed.
   */
  name() {
    const parts = []
    for (;;) {
      this.skip()
      const character = this.peek()
      if (character === '"' || character === "'") parts.push(this.string())
      else {
        const start = this.at
        while (this.peek() !== undefined && BARE.test(this.peek())) this.at += 1
        const word = this.text.slice(start, this.at)
        if (word === '') throw new ConfError('expected a name')
        parts.push(word)
      }
      this.skip()
      if (!this.eat('.')) return parts
    }
  }

  /**
   * Read one value: a scalar, an array, or an inline table.
   * @param path - this value's own path counted from the root, so an inline table names its keys in full.
   * @returns the value as `{ type, value }`, with `table` and `array` carrying their contents.
   * @throws {ConfError} when the value is malformed, or when no value is written where one is required.
   */
  value(path) {
    this.skip()
    const character = this.peek()
    if (character === undefined) throw new ConfError('expected a value')
    if (character === '"' || character === "'") return { type: 'string', value: this.string() }
    if (character === '[') return this.array(path)
    if (character === '{') return this.inline(path)
    const start = this.at
    while (this.peek() !== undefined && !' \t,]}'.includes(this.peek())) this.at += 1
    const word = this.text.slice(start, this.at)
    if (word === '') throw new ConfError('expected a value')
    if (word === 'true' || word === 'false') return { type: 'boolean', value: word === 'true' }
    const plain = word.replaceAll('_', '')
    if (INTEGER.test(word)) return { type: 'integer', value: Number(plain) }
    if (FLOAT.test(word)) return { type: 'float', value: Number(plain) }
    throw new ConfError(`invalid value ${word}`)
  }

  /**
   * Read a bracketed array, whose items may themselves be arrays or inline tables.
   * @param path - the array's own path counted from the root; an item extends it with its index.
   */
  array(path) {
    this.at += 1
    const items = []
    for (;;) {
      this.skip()
      if (this.peek() === undefined) throw new ConfError('unterminated array')
      if (this.eat(']')) return { type: 'array', value: items }
      items.push(this.value(`${path}[${items.length}]`))
      this.skip()
      if (this.eat(',')) continue
      this.skip()
      if (this.eat(']')) return { type: 'array', value: items }
      throw new ConfError('unterminated array')
    }
  }

  /**
   * Read a braced inline table, whose keys may be dotted.
   * @param path - the table's own path counted from the root, which its errors name their keys under.
   */
  inline(path) {
    this.at += 1
    const table = { type: 'table', value: new Map() }
    this.skip()
    if (this.eat('}')) return table
    for (;;) {
      const parts = this.name()
      this.skip()
      if (!this.eat('=')) throw new ConfError('expected = in an inline table')
      const held = this.value(under(path, parts.join('.')))
      let target = table
      for (const [index, part] of parts.slice(0, -1).entries()) {
        const next = target.value.get(part) ?? { type: 'table', value: new Map() }
        if (next.type !== 'table') throw new ConfError(`${under(path, parts.slice(0, index + 1).join('.'))} is not a table`)
        target.value.set(part, next)
        target = next
      }
      const last = parts[parts.length - 1]
      if (target.value.has(last)) throw new ConfError(`key ${under(path, parts.join('.'))} is defined twice`)
      target.value.set(last, held)
      this.skip()
      if (this.eat(',')) continue
      this.skip()
      if (this.eat('}')) return table
      throw new ConfError('unterminated inline table')
    }
  }
}
