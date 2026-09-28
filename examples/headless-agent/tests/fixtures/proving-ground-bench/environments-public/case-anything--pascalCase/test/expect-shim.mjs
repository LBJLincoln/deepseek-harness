/**
 * The `expect` a synthesized environment's hidden cases run under: a vitest
 * matcher subset small enough to ship without a test runner, so a case runs
 * under plain `node` with nothing installed. The repository factory
 * (`synthesize-repository-tasks.ts`) inlines this file's text verbatim ahead
 * of each case; the public factory (`synthesize-public-tasks.ts`) writes it
 * into each child's workspace as `test/expect-shim.mjs`, immutable, and each
 * case imports it. Both factories admit a spec block only when every matcher
 * it uses is one of these, so a case never reaches a matcher this shim lacks.
 *
 * A failed assertion throws {@link AssertionError}, which an ESM program
 * leaves uncaught: node prints the message and exits non-zero, which is the
 * case's verdict. Semantics follow vitest's for the subset: `toEqual` ignores
 * `undefined`-valued properties and prototypes, `toStrictEqual` checks both,
 * `toMatchObject` requires every expected property recursively and nothing
 * more, `toContain` uses SameValueZero on arrays and substring on strings,
 * `toContainEqual` structural equality on any element, `toBeCloseTo` the
 * vitest bound of half a unit in the last requested decimal, `toHaveProperty`
 * a dotted or array key path with an optional structural value, and `toThrow`
 * (alias `toThrowError`) accepts no argument, a message substring, a RegExp
 * over the message, an Error whose message must match exactly, or an Error
 * class the thrown value must be an instance of;
 * `toThrowErrorMatchingInlineSnapshot` compares the thrown error against
 * vitest's `[Name: message]` rendering. `expectTypeOf` and `assertType` are
 * the runtime no-ops vitest also ships, so a block that checks types beside
 * values runs unchanged.
 */

/** A failed matcher, carrying the message a case reports on stderr. */
export class AssertionError extends Error {
  /** @param message - what was expected and what was found. */
  constructor(message) {
    super(message)
    this.name = 'AssertionError'
  }
}

/** A readable rendering of one value for an assertion message. */
function format(value) {
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`
  if (typeof value === 'symbol') return value.toString()
  if (value instanceof Error) return `${value.name}(${JSON.stringify(value.message)})`
  if (value instanceof RegExp) return value.toString()
  try {
    return JSON.stringify(value, (_key, inner) => (typeof inner === 'bigint' ? `${inner}n` : inner === undefined ? 'undefined' : inner)) ?? String(value)
  } catch {
    // JSON.stringify throws on a cycle; the message then names the value's type instead of its contents.
    return Object.prototype.toString.call(value)
  }
}

/** Own enumerable string keys, dropping the `undefined`-valued ones unless `strict`. */
function keysOf(value, strict) {
  return Object.keys(value).filter(key => strict || value[key] !== undefined)
}

/**
 * Structural equality: `Object.is` on primitives, then arrays, typed arrays,
 * `Date`, `RegExp`, `Error`, `Map`, `Set`, and plain objects by content. A
 * pair already being compared higher in the recursion counts as equal, so a
 * cycle terminates.
 */
function equals(left, right, strict, seen = []) {
  if (Object.is(left, right)) return true
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false
  if (seen.some(([a, b]) => a === left && b === right)) return true
  const pairs = [...seen, [left, right]]
  if (strict && Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false
  if (left instanceof Date || right instanceof Date) return left instanceof Date && right instanceof Date && left.getTime() === right.getTime()
  if (left instanceof RegExp || right instanceof RegExp) return left instanceof RegExp && right instanceof RegExp && left.source === right.source && left.flags === right.flags
  if (left instanceof Error || right instanceof Error) {
    return left instanceof Error && right instanceof Error && left.name === right.name && left.message === right.message
  }
  if (ArrayBuffer.isView(left) || ArrayBuffer.isView(right)) {
    if (!ArrayBuffer.isView(left) || !ArrayBuffer.isView(right) || left.length !== right.length) return false
    for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false
    return true
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((item, index) => equals(item, right[index], strict, pairs))
  }
  if (left instanceof Map || right instanceof Map) {
    if (!(left instanceof Map) || !(right instanceof Map) || left.size !== right.size) return false
    for (const [key, value] of left) {
      const match = [...right].find(([otherKey]) => equals(key, otherKey, strict, pairs))
      if (match === undefined || !equals(value, match[1], strict, pairs)) return false
    }
    return true
  }
  if (left instanceof Set || right instanceof Set) {
    if (!(left instanceof Set) || !(right instanceof Set) || left.size !== right.size) return false
    for (const item of left) if (![...right].some(other => equals(item, other, strict, pairs))) return false
    return true
  }
  const leftKeys = keysOf(left, strict)
  const rightKeys = keysOf(right, strict)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every(key => rightKeys.includes(key) && equals(left[key], right[key], strict, pairs))
}

/** The message text of a thrown value, whatever its type. */
function thrownMessage(thrown) {
  return thrown instanceof Error ? thrown.message : String(thrown)
}

/** Whether `thrown` satisfies `expected` under `toThrow`'s argument forms. */
function throwMatches(thrown, expected) {
  if (expected === undefined) return true
  if (typeof expected === 'string') return thrownMessage(thrown).includes(expected)
  if (expected instanceof RegExp) return expected.test(thrownMessage(thrown))
  if (expected instanceof Error) return thrownMessage(thrown) === expected.message
  if (typeof expected === 'function') return thrown instanceof expected
  throw new TypeError(`toThrow does not accept ${format(expected)}`)
}

/** vitest's inline-snapshot rendering of a thrown value: `[Name: message]` for an Error, the quoted string otherwise. */
function snapshotOf(thrown) {
  return thrown instanceof Error ? `[${thrown.name}: ${thrown.message}]` : JSON.stringify(String(thrown))
}

/** Whether `actual` carries every property of `expected`, recursively, with anything else allowed beside them. */
function matchesObject(actual, expected, seen = []) {
  if (typeof expected !== 'object' || expected === null || typeof actual !== 'object' || actual === null) return equals(actual, expected, false)
  if (seen.some(([a, b]) => a === actual && b === expected)) return true
  const pairs = [...seen, [actual, expected]]
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length && expected.every((item, index) => matchesObject(actual[index], item, pairs))
  }
  if (expected instanceof Date || expected instanceof RegExp || expected instanceof Error || expected instanceof Map || expected instanceof Set) {
    return equals(actual, expected, false)
  }
  return Object.keys(expected).every(key => key in actual && matchesObject(actual[key], expected[key], pairs))
}

/** The segments of a `toHaveProperty` key path: an array as given, a string split on dots. */
function keyPath(path) {
  return Array.isArray(path) ? path : String(path).split('.')
}

/**
 * The matcher set over one value, negated or not. Each matcher decides a pass
 * and a description; `verdict` throws when the pass disagrees with the
 * negation, so `not` costs one flag rather than a second set of matchers.
 */
function matchers(actual, negated) {
  const verdict = (pass, description) => {
    if (pass !== negated) return
    throw new AssertionError(`expected ${format(actual)} ${negated ? 'not ' : ''}${description}`)
  }
  const lengthOf = () => (actual !== null && actual !== undefined && typeof actual.length === 'number' ? actual.length : undefined)
  const throws = () => {
    if (typeof actual !== 'function') throw new TypeError(`toThrow needs a function, got ${format(actual)}`)
    try {
      actual()
    } catch (thrown) {
      return { thrown }
    }
    return undefined
  }
  const toThrow = (expected) => {
    const outcome = throws()
    const description = expected === undefined ? 'to throw' : `to throw ${format(expected)}`
    verdict(outcome !== undefined && throwMatches(outcome.thrown, expected), outcome === undefined ? description : `${description}, got ${format(outcome.thrown)}`)
  }
  const iterableHas = predicate => actual !== null && actual !== undefined && typeof actual[Symbol.iterator] === 'function' && Array.from(actual).some(predicate)
  return {
    toBe: expected => verdict(Object.is(actual, expected), `to be ${format(expected)}`),
    toEqual: expected => verdict(equals(actual, expected, false), `to equal ${format(expected)}`),
    toStrictEqual: expected => verdict(equals(actual, expected, true), `to strictly equal ${format(expected)}`),
    toMatchObject: expected => verdict(matchesObject(actual, expected), `to match object ${format(expected)}`),
    toBeUndefined: () => verdict(actual === undefined, 'to be undefined'),
    toBeDefined: () => verdict(actual !== undefined, 'to be defined'),
    toBeNull: () => verdict(actual === null, 'to be null'),
    toBeNaN: () => verdict(Number.isNaN(actual), 'to be NaN'),
    toBeTruthy: () => verdict(Boolean(actual), 'to be truthy'),
    toBeFalsy: () => verdict(!actual, 'to be falsy'),
    toBeTypeOf: expected => verdict(typeof actual === expected, `to be of type ${format(expected)}`),
    toBeInstanceOf: expected => verdict(actual instanceof expected, `to be an instance of ${format(expected)}`),
    toHaveLength: expected => verdict(lengthOf() === expected, `to have length ${format(expected)}`),
    toHaveProperty: (path, ...value) => {
      let cursor = actual
      let present = true
      for (const key of keyPath(path)) {
        if (cursor === null || cursor === undefined || !(key in Object(cursor))) {
          present = false
          break
        }
        cursor = cursor[key]
      }
      const holds = present && (value.length === 0 || equals(cursor, value[0], false))
      verdict(holds, `to have property ${format(path)}${value.length === 0 ? '' : ` equal to ${format(value[0])}`}`)
    },
    toContain: (expected) => {
      const holds = typeof actual === 'string' ? actual.includes(expected) : iterableHas(item => Object.is(item, expected) || item === expected)
      verdict(holds, `to contain ${format(expected)}`)
    },
    toContainEqual: expected => verdict(iterableHas(item => equals(item, expected, false)), `to contain an item equal to ${format(expected)}`),
    toThrow,
    toThrowError: toThrow,
    toThrowErrorMatchingInlineSnapshot: (snapshot) => {
      const outcome = throws()
      const rendered = outcome === undefined ? undefined : snapshotOf(outcome.thrown)
      verdict(rendered !== undefined && rendered === String(snapshot).trim(), `to throw an error rendering as ${format(String(snapshot).trim())}${rendered === undefined ? '' : `, got ${format(rendered)}`}`)
    },
    toMatch: (expected) => {
      if (typeof actual !== 'string') throw new TypeError(`toMatch needs a string, got ${format(actual)}`)
      verdict(expected instanceof RegExp ? expected.test(actual) : actual.includes(expected), `to match ${format(expected)}`)
    },
    toBeGreaterThan: expected => verdict(actual > expected, `to be greater than ${format(expected)}`),
    toBeGreaterThanOrEqual: expected => verdict(actual >= expected, `to be at least ${format(expected)}`),
    toBeLessThan: expected => verdict(actual < expected, `to be less than ${format(expected)}`),
    toBeLessThanOrEqual: expected => verdict(actual <= expected, `to be at most ${format(expected)}`),
    toBeCloseTo: (expected, digits = 2) => {
      const holds = actual === Infinity && expected === Infinity || actual === -Infinity && expected === -Infinity
        || Math.abs(expected - actual) < 10 ** -digits / 2
      verdict(holds, `to be close to ${format(expected)} within ${digits} decimal places`)
    },
  }
}

/**
 * The assertion entry point, as a case program calls it.
 * @param actual - the value under assertion.
 * @returns the matcher subset over `actual`, with `not` negating each matcher.
 */
export function expect(actual) {
  return { ...matchers(actual, false), not: matchers(actual, true) }
}

/** A callable whose every property is itself, so any chain of type-assertion calls returns without effect. */
const inert = new Proxy(function inert() {}, {
  get: (_target, key) => (key === Symbol.toPrimitive ? () => '' : inert),
  apply: () => inert,
})

/**
 * vitest's `expectTypeOf`, which asserts nothing at runtime: the type check
 * lives in the compiler, and the JavaScript build of a spec keeps the call.
 * @returns an inert chain accepting any matcher.
 */
export function expectTypeOf() {
  return inert
}

/**
 * vitest's `assertType`, a runtime no-op that types its argument.
 */
export function assertType() {}
