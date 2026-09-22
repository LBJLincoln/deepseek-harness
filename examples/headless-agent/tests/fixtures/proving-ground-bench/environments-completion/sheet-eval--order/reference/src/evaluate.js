/** Sheet values: the value kinds, error propagation, and the memoized evaluator. */

import { address, name, parse, SyntaxError_ } from './parse.js'

/** Every error token a cell may take. */
export const ERRORS = ['#DIV/0!', '#REF!', '#VALUE!', '#CYCLE!', '#NAME?', '#ERR!']

/** The functions a formula may call, with how many arguments each takes. */
const ARITY = { SUM: undefined, MIN: undefined, MAX: undefined, COUNT: undefined, AVG: undefined, ABS: 1, IF: 3 }

/** A value carrying an error token, or `undefined` for anything else. */
function errorOf(value) {
  return value.kind === 'error' ? value : undefined
}

/** Rank the three value kinds so a comparison across kinds is still total. */
function rank(value) {
  return value.kind === 'number' ? 0 : (value.kind === 'text' ? 1 : 2)
}

/** The number a value stands for, or the error a non-numeric value earns. */
function asNumber(value) {
  if (value.kind === 'number') return value
  if (value.kind === 'boolean') return { kind: 'number', value: value.value ? 1 : 0 }
  return { kind: 'error', value: '#VALUE!' }
}

/** A finite result, or the division error a non-finite one earns. */
function finite(result) {
  return Number.isFinite(result) ? { kind: 'number', value: result } : { kind: 'error', value: '#DIV/0!' }
}

/** Compare two values of the same kind, and across kinds by number, then text, then boolean. */
function order(left, right) {
  if (rank(left) !== rank(right)) return rank(left) - rank(right)
  if (left.kind === 'number') return left.value - right.value
  if (left.kind === 'text') return left.value < right.value ? -1 : (left.value === right.value ? 0 : 1)
  return (left.value ? 1 : 0) - (right.value ? 1 : 0)
}

/** The literal a cell's text stands for when it is not a formula. */
function literal(text) {
  if (text === '') return { kind: 'number', value: 0 }
  if (/^-?[0-9]+(?:\.[0-9]+)?$/u.test(text)) return { kind: 'number', value: Number(text) }
  if (ERRORS.includes(text)) return { kind: 'error', value: text }
  return { kind: 'text', value: text }
}

/**
 * The sheet: cells by address, with their parsed formulas, and memoized values.
 */
export class Sheet {
  /**
   * @param cells - the declared cells, as a map from address to source text.
   */
  constructor(cells) {
    this.cells = cells
    this.values = new Map()
    this.open = new Set()
  }

  /**
   * The value of one cell, computed once and remembered.
   * @param cell - the upper-case address.
   * @returns the value, which may be an error.
   */
  value(cell) {
    const known = this.values.get(cell)
    if (known !== undefined) return known
    if (this.open.has(cell)) return { kind: 'error', value: '#CYCLE!' }
    const source = this.cells.get(cell)
    if (source === undefined) return { kind: 'number', value: 0 }
    if (!source.startsWith('=')) {
      const computed = literal(source)
      this.values.set(cell, computed)
      return computed
    }
    this.open.add(cell)
    let computed
    try {
      computed = this.expression(parse(source.slice(1)))
    } catch (error) {
      if (!(error instanceof SyntaxError_)) throw error
      computed = { kind: 'error', value: error.code }
    } finally {
      this.open.delete(cell)
    }
    this.values.set(cell, computed)
    return computed
  }

  /** The values a range covers, by ascending column and then ascending row. */
  range(from, to) {
    const start = address(from)
    const end = address(to)
    if (start === undefined || end === undefined) return [{ kind: 'error', value: '#REF!' }]
    const out = []
    for (let column = Math.min(start.column, end.column); column <= Math.max(start.column, end.column); column += 1) {
      for (let row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row += 1) {
        out.push(this.value(name(column, row)))
      }
    }
    return out
  }

  /** The values one argument contributes: a range spreads, anything else is itself. */
  spread(node) {
    return node.kind === 'range' ? this.range(node.from, node.to) : [this.expression(node)]
  }

  /** Evaluate one expression node against this sheet. */
  expression(node) {
    switch (node.kind) {
      case 'number':
        return { kind: 'number', value: node.value }
      case 'ref': {
        if (node.cell === 'TRUE') return { kind: 'boolean', value: true }
        if (node.cell === 'FALSE') return { kind: 'boolean', value: false }
        return address(node.cell) === undefined ? { kind: 'error', value: '#REF!' } : this.value(node.cell)
      }
      case 'range':
        return { kind: 'error', value: '#ERR!' }
      case 'unary': {
        const operand = asNumber(this.expression(node.operand))
        return errorOf(operand) ?? { kind: 'number', value: node.operator === '-' ? -operand.value : operand.value }
      }
      case 'binary':
        return this.binary(node)
      default:
        return this.call(node)
    }
  }

  /** Evaluate a binary operator, taking the leftmost error before anything else. */
  binary(node) {
    const left = this.expression(node.left)
    const right = this.expression(node.right)
    const failed = errorOf(left) ?? errorOf(right)
    if (failed !== undefined) return failed
    if (['=', '<>', '<', '<=', '>', '>='].includes(node.operator)) {
      const sign = order(left, right)
      const table = { '=': sign === 0, '<>': sign !== 0, '<': sign < 0, '<=': sign <= 0, '>': sign > 0, '>=': sign >= 0 }
      return { kind: 'boolean', value: table[node.operator] }
    }
    const a = asNumber(left)
    const b = asNumber(right)
    const bad = errorOf(a) ?? errorOf(b)
    if (bad !== undefined) return bad
    if (node.operator === '/' && b.value === 0) return { kind: 'error', value: '#DIV/0!' }
    const table = { '+': a.value + b.value, '-': a.value - b.value, '*': a.value * b.value, '/': a.value / b.value, '^': a.value ** b.value }
    return finite(table[node.operator])
  }

  /** Evaluate a function call, checking its name and argument count first. */
  call(node) {
    if (!(node.name in ARITY)) return { kind: 'error', value: '#NAME?' }
    const arity = ARITY[node.name]
    if (arity !== undefined && node.args.length !== arity) return { kind: 'error', value: '#ERR!' }
    if (arity === undefined && node.args.length === 0) return { kind: 'error', value: '#ERR!' }
    if (node.name === 'IF') return this.branch(node)
    const values = node.args.flatMap(argument => this.spread(argument))
    const failed = values.find(value => value.kind === 'error')
    if (failed !== undefined) return failed
    if (node.name === 'COUNT') return { kind: 'number', value: values.filter(value => value.kind === 'number').length }
    const numbers = values.map(asNumber)
    const bad = numbers.find(value => value.kind === 'error')
    if (bad !== undefined) return bad
    const raw = numbers.map(value => value.value)
    if (node.name === 'ABS') return { kind: 'number', value: Math.abs(raw[0]) }
    if (node.name === 'MIN') return { kind: 'number', value: Math.min(...raw) }
    if (node.name === 'MAX') return { kind: 'number', value: Math.max(...raw) }
    if (node.name === 'SUM') return { kind: 'number', value: raw.reduce((total, one) => total + one, 0) }
    return finite(raw.reduce((total, one) => total + one, 0) / raw.length)
  }

  /** `IF` returns only the branch it takes, so an error in the other branch is invisible. */
  branch(node) {
    const condition = this.expression(node.args[0])
    const failed = errorOf(condition)
    if (failed !== undefined) return failed
    if (condition.kind === 'text') return { kind: 'error', value: '#VALUE!' }
    const taken = condition.kind === 'boolean' ? condition.value : condition.value !== 0
    return this.expression(node.args[taken ? 1 : 2])
  }
}

/**
 * The addresses one cell's formula names directly, ranges expanded.
 * @param source - the cell's source text.
 * @returns the distinct addresses, sorted by column and then by row; empty for a literal or an unparsable formula.
 */
export function references(source) {
  if (!source.startsWith('=')) return []
  let tree
  try {
    tree = parse(source.slice(1))
  } catch (error) {
    if (!(error instanceof SyntaxError_)) throw error
    return []
  }
  const found = new Set()
  const walk = node => {
    if (node.kind === 'ref') {
      if (address(node.cell) !== undefined) found.add(node.cell)
      return
    }
    if (node.kind === 'range') {
      const start = address(node.from)
      const end = address(node.to)
      if (start === undefined || end === undefined) return
      for (let column = Math.min(start.column, end.column); column <= Math.max(start.column, end.column); column += 1) {
        for (let row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row += 1) found.add(name(column, row))
      }
      return
    }
    for (const key of ['operand', 'left', 'right']) {
      if (node[key] !== undefined) walk(node[key])
    }
    for (const argument of node.args ?? []) walk(argument)
  }
  walk(tree)
  return [...found].sort((left, right) => {
    const a = address(left)
    const b = address(right)
    return a.column - b.column || a.row - b.row
  })
}

/**
 * How a value prints.
 * @param value - the evaluated value.
 * @returns the printed text.
 */
export function show(value) {
  if (value.kind === 'error') return value.value
  if (value.kind === 'boolean') return value.value ? 'TRUE' : 'FALSE'
  if (value.kind === 'text') return value.value
  return String(Number(value.value.toPrecision(10)))
}
