/** Cell addressing, tokenizing, and the recursive-descent parser for formulas. */

/** A cell address: one or two column letters and a row of one to three digits. */
const ADDRESS = /^([A-Z]{1,2})([0-9]{1,3})$/u

/** The comparison operators, longest first so `<=` wins over `<`. */
const COMPARISONS = ['<=', '>=', '<>', '=', '<', '>']

/** Raised when a formula cannot be parsed; the evaluator turns it into a cell error. */
export class SyntaxError_ extends Error {
  /**
   * @param code - the error token the cell takes, such as `#ERR!`.
   */
  constructor(code) {
    super(code)
    this.name = 'SyntaxError_'
    this.code = code
  }
}

/**
 * The column and row of a cell address, or `undefined` when it is out of range.
 * @param text - the address, in upper case.
 * @returns `{ column, row }` with a 1-based column index, or `undefined`.
 */
export function address(text) {
  const match = ADDRESS.exec(text)
  if (match === null) return undefined
  let column = 0
  for (const letter of match[1]) column = column * 26 + (letter.codePointAt(0) - 64)
  const row = Number(match[2])
  return row === 0 ? undefined : { column, row }
}

/**
 * The address of a column and row, so an expanded range names real cells.
 * @param column - the 1-based column index, at most 702.
 * @param row - the 1-based row, at most 999.
 * @returns the address text.
 */
export function name(column, row) {
  const letters = column <= 26
    ? String.fromCharCode(64 + column)
    : String.fromCharCode(64 + Math.floor((column - 1) / 26)) + String.fromCharCode(65 + ((column - 1) % 26))
  return `${letters}${row}`
}

/** Split a formula body into tokens, upper-casing every name it meets. */
function tokenize(text) {
  const tokens = []
  let index = 0
  while (index < text.length) {
    const character = text[index]
    if (character === ' ' || character === '\t') {
      index += 1
      continue
    }
    const comparison = COMPARISONS.find(operator => text.startsWith(operator, index))
    if (comparison !== undefined) {
      tokens.push({ kind: 'operator', text: comparison })
      index += comparison.length
      continue
    }
    if ('+-*/^(),:'.includes(character)) {
      tokens.push({ kind: 'operator', text: character })
      index += 1
      continue
    }
    const number = /^[0-9]+(?:\.[0-9]+)?/u.exec(text.slice(index))
    if (number !== null) {
      tokens.push({ kind: 'number', value: Number(number[0]) })
      index += number[0].length
      continue
    }
    const word = /^[A-Za-z][A-Za-z0-9_.]*/u.exec(text.slice(index))
    if (word === null) throw new SyntaxError_('#ERR!')
    tokens.push({ kind: 'word', text: word[0].toUpperCase() })
    index += word[0].length
  }
  return tokens
}

/**
 * Parse a formula body into an expression tree.
 * @param body - the text after the leading `=`.
 * @returns the tree of `number`, `ref`, `range`, `call`, `unary`, and `binary` nodes.
 * @throws {SyntaxError_} with `#ERR!` for a syntax failure.
 */
export function parse(body) {
  throw new Error('not implemented')
}
