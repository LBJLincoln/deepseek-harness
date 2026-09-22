import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  analyzeModule,
  analyzeSpec,
  analyzeSpecImports,
  caseEntries,
  childId,
  childReadme,
  childTaskJson,
  importsOnlyModule,
  MATCHER_SUBSET,
  parseArgs,
  parseTierBands,
  REPOSITORY_CHECKS,
  STUB_BODY,
  stubFunction,
  taskId,
  tierFor,
  transpile,
} from './fixtures/proving-ground-bench/tools/repository-environments.ts'
import type { FactoryOptions, SpecCase } from './fixtures/proving-ground-bench/tools/repository-environments.ts'

const toolsDir = fileURLToPath(new URL('./fixtures/proving-ground-bench/tools/', import.meta.url))
const shim = readFileSync(join(toolsDir, 'expect-shim.mjs'), 'utf8')
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'repository-family-spec-'))
  roots.push(root)
  return root
}

function write(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
}

/** Runs one ESM program the way a hidden case runs: from standard input, in `cwd`. */
function runProgram(cwd: string, program: string): { status: number | null; stderr: string; stdout: string } {
  const result = spawnSync(process.execPath, ['--input-type=module'], { cwd, input: program, encoding: 'utf8' })
  return { status: result.status, stderr: result.stderr, stdout: result.stdout }
}

const MODULE_TS = `/**
 * Greeting helpers.
 * @module @example/greet
 */

/** How loud a greeting is. */
export type Volume = 'quiet' | 'loud'

/**
 * A greeting with its volume.
 */
export interface Greeting {
  readonly text: string
  readonly volume: Volume
}

/**
 * Greets a name.
 * @param name - who is greeted.
 * @returns the greeting.
 */
export function greet(name: string): string {
  return \`hello \${name}\`
}

/**
 * Shouts a text.
 * @param text - what is shouted.
 * @returns the text upper-cased, with a bang.
 */
export const shout = (text: string): string => {
  return \`\${text.toUpperCase()}!\`
}

/** A comment separated from the declaration by a blank line is not its JSDoc. */

export function undocumented(): number {
  return 2
}

/** Documented, and reached by no spec block. */
export function idle(): number {
  return 1
}

/** A function expression with a block body is stubbable like an arrow. */
export const wrapped = function (text: string): string {
  return text
}

/** An overload signature has no body; only the implementation is located. */
export function pick(value: string): string
export function pick(value: number): number
export function pick(value: unknown): unknown {
  return value
}

// An ordinary comment above a declaration is not its documentation.
/** An empty body spans no line. */
export function noop(): void {}

export let counter: number

export const terse = (value: number): number => value + 1

function hidden(): void {}
`

const SPEC_TS = `import { describe, expect, it } from 'vitest'
import { greet, shout, type Greeting } from '../src/index.ts'
import type { Volume } from '../src/index.ts'

const suffix = '!'

describe('greet', () => {
  const name = 'ada'
  it('greets by name', () => {
    expect(greet(name)).toBe('hello ada')
  })
  describe('nested', () => {
    const shouted = shout('ab')
    it('shouts inside the nested block', async () => {
      const value = await Promise.resolve(shouted)
      expect(value).toBe(\`AB\${suffix}\`)
    }, 5_000)
  })
})

it('a top-level it works too', () => {
  expect(shout('x')).toContain('X')
})
`

describe('transpile', () => {
  it('strips types, keeps comments, and elides type-only imports', () => {
    const js = transpile(SPEC_TS, 'greet.spec.ts')
    expect(js).toMatch(/import \{ greet, shout,? \} from '\.\.\/src\/index\.ts'/u)
    expect(js).not.toContain('Volume')
    expect(js).not.toContain(': string')
    expect(transpile(MODULE_TS, 'index.ts')).toContain('* Greets a name.')
  })

  it('refuses a source that does not parse', () => {
    expect(() => transpile('export function (', 'broken.ts')).toThrow(/broken\.ts: /)
  })
})

describe('analyzeModule', () => {
  const analysis = analyzeModule(MODULE_TS, 'index.ts')

  it('finds every exported block-bodied function with its own JSDoc, signature, and body length', () => {
    expect(analysis.functions.map(fn => fn.name)).toEqual(['greet', 'shout', 'undocumented', 'idle', 'wrapped', 'pick', 'noop'])
    const [greet, shout, undocumented, idle, wrapped, pick, noop] = analysis.functions
    expect(greet?.jsDoc).toBe('/**\n * Greets a name.\n * @param name - who is greeted.\n * @returns the greeting.\n */')
    expect(greet?.signature).toBe('export function greet(name: string): string')
    expect(greet?.bodyLines).toBe(1)
    expect(shout?.signature).toBe('export const shout = (text: string): string =>')
    expect(shout?.jsDoc).toContain('Shouts a text.')
    expect(undocumented?.jsDoc).toBe('')
    expect(idle?.jsDoc).toBe('/** Documented, and reached by no spec block. */')
    expect(wrapped?.signature).toBe('export const wrapped = function (text: string): string')
    // The JSDoc sits on the first overload signature, which has no body; the implementation carries none of its own.
    expect(pick?.jsDoc).toBe('')
    expect(pick?.signature).toBe('export function pick(value: unknown): unknown')
    expect(noop?.bodyLines).toBe(0)
  })

  it('attaches the last directly adjacent JSDoc only, never the module comment', () => {
    expect(analysis.types.map(type => type.name)).toEqual(['Volume', 'Greeting'])
    expect(analysis.types[0]?.text).toBe("/** How loud a greeting is. */\nexport type Volume = 'quiet' | 'loud'")
    expect(analysis.types[1]?.text.startsWith('/**\n * A greeting with its volume.')).toBe(true)
  })
})

describe('stubFunction', () => {
  const js = transpile(MODULE_TS, 'index.ts')

  it('replaces one declaration body and leaves every other byte in place', () => {
    const stubbed = stubFunction(js, 'greet', 'index.js')
    expect(stubbed).toContain(`export function greet(name) ${STUB_BODY}`)
    expect(stubbed.replace(STUB_BODY, '')).toBe(js.replace('{\n    return `hello ${name}`;\n}', ''))
    expect(stubbed).toContain('export const shout = (text) => {\n    return `${text.toUpperCase()}!`;\n};')
  })

  it('stubs an exported arrow with a block body', () => {
    expect(stubFunction(js, 'shout', 'index.js')).toContain(`export const shout = (text) => ${STUB_BODY};`)
  })

  it('refuses a name that is not an exported block-bodied function', () => {
    expect(() => stubFunction(js, 'terse', 'index.js')).toThrow('index.js: no exported function terse with a block body')
    expect(() => stubFunction(js, 'hidden', 'index.js')).toThrow('no exported function hidden')
  })
})

describe('analyzeSpecImports / importsOnlyModule', () => {
  const specifiers = ['../src/index.ts', '@example/greet']

  it('lists runtime imports and ignores type-only ones', () => {
    const imports = analyzeSpecImports(SPEC_TS, 'greet.spec.ts')
    expect(imports).toEqual({ runtime: ['../src/index.ts'] })
    expect(importsOnlyModule(imports, specifiers)).toBeUndefined()
  })

  it('keeps listing the module import after rejecting a vitest binding outside the four', () => {
    const imports = analyzeSpecImports("import { afterEach, describe, expect, it, vi } from 'vitest'\nimport { greet } from '@example/greet'\n", 'a.spec.ts')
    expect(imports).toEqual({ runtime: ['@example/greet'], rejection: 'imports afterEach from vitest' })
    expect(importsOnlyModule(imports, specifiers)).toBe('imports afterEach from vitest')
  })

  it('treats an all-type-only named import as erased and a mixed one as runtime', () => {
    expect(analyzeSpecImports("import { type A } from 'elsewhere'\nimport { greet } from '@example/greet'\n", 'a.spec.ts')).toEqual({ runtime: ['@example/greet'] })
    expect(analyzeSpecImports("import { type A, b } from 'elsewhere'\n", 'a.spec.ts')).toEqual({ runtime: ['elsewhere'] })
  })

  it('rejects a default or namespace vitest import and a side-effect import', () => {
    expect(analyzeSpecImports("import * as vitest from 'vitest'\n", 'a.spec.ts').rejection).toBe('imports vitest as a default or namespace')
    expect(analyzeSpecImports("import 'reflect-metadata'\n", 'a.spec.ts').rejection).toBe('imports reflect-metadata for its side effects')
    expect(analyzeSpecImports("import fs from 'node:fs'\n", 'a.spec.ts')).toEqual({ runtime: ['node:fs'] })
  })

  it('names the first foreign import and refuses a spec that imports nothing under test', () => {
    expect(importsOnlyModule({ runtime: ['@example/greet', 'node:fs/promises'] }, specifiers)).toBe('imports node:fs/promises')
    expect(importsOnlyModule({ runtime: [] }, specifiers)).toBe('imports nothing under test')
  })
})

describe('analyzeSpec', () => {
  const options = { moduleSpecifiers: ['../src/index.ts', '@example/greet'], moduleImport: './src/index.js', shim }

  function cases(specTs: string): readonly SpecCase[] {
    const analysis = analyzeSpec(transpile(specTs, 'greet.spec.ts'), 'greet.spec.ts', options)
    expect(analysis.kind).toBe('cases')
    return analysis.kind === 'cases' ? analysis.cases : []
  }

  function reason(specTs: string): string {
    const analysis = analyzeSpec(transpile(specTs, 'greet.spec.ts'), 'greet.spec.ts', options)
    return analysis.kind === 'rejected' ? analysis.reason : `accepted ${analysis.cases.length} case(s)`
  }

  it('yields one case per it block, titled by its describe path, in source order', () => {
    expect(cases(SPEC_TS).map(one => [one.ordinal, one.title])).toEqual([
      [1, 'greet › greets by name'],
      [2, 'greet › nested › shouts inside the nested block'],
      [3, 'a top-level it works too'],
    ])
  })

  it('assembles a program from the shim, the redirected import, the preludes, and the body, nested by level', () => {
    const [, nested] = cases(SPEC_TS)
    const program = nested?.program ?? ''
    expect(program.startsWith(shim.trimEnd())).toBe(true)
    expect(program).toMatch(/\nimport \{ greet, shout,? \} from "\.\/src\/index\.js";\n/u)
    expect(program).not.toMatch(/from ['"]vitest['"]/u)
    const order = ["const suffix = '!';", '{', "const name = 'ada';", '{', "const shouted = shout('ab');", '{', 'const value = await Promise.resolve(shouted);', '}', '}', '}']
    let cursor = -1
    for (const line of order) {
      const at = program.indexOf(line, cursor + 1)
      expect(at, `expected ${line} after position ${cursor}`).toBeGreaterThan(cursor)
      cursor = at
    }
  })

  it('produces programs that pass against the module and fail against a stub of the function they exercise', () => {
    const root = scratch()
    const js = transpile(MODULE_TS, 'index.ts')
    write(root, { 'reference/src/index.js': js, 'stub/src/index.js': stubFunction(js, 'shout', 'index.js') })
    const [greets, nested, top] = cases(SPEC_TS)
    for (const one of [greets, nested, top]) expect(runProgram(join(root, 'reference'), one?.program ?? '').status).toBe(0)
    expect(runProgram(join(root, 'stub'), greets?.program ?? '').status).toBe(0)
    const failed = runProgram(join(root, 'stub'), nested?.program ?? '')
    expect(failed.status).toBe(1)
    expect(failed.stderr).toContain('Error: not implemented')
    expect(runProgram(join(root, 'stub'), top?.program ?? '').status).toBe(1)
  })

  it('reports a failed assertion by its message and a non-zero exit', () => {
    const root = scratch()
    write(root, { 'src/index.js': transpile(MODULE_TS, 'index.ts') })
    const [only] = cases("import { expect, it } from 'vitest'\nimport { greet } from '@example/greet'\nit('x', () => { expect(greet('a')).toBe('bye') })\n")
    const result = runProgram(root, only?.program ?? '')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('AssertionError: expected "hello a" to be "bye"')
  })

  const prologue = "import { describe, expect, it, test } from 'vitest'\nimport { greet } from '@example/greet'\n"

  it.each([
    ["describe('d', () => { it.each([1])('n', () => {}) })", 'uses it.each'],
    ["describe.skip('d', () => { it('n', () => {}) })", 'uses describe.skip'],
    ["it('n', ({ expect }) => { expect(1).toBe(1) })", 'it callback takes parameters'],
    ["it('n', () => expect(1).toBe(1))", 'it callback has no block body'],
    ["const title = 'n'\nit(title, () => {})", 'it title is not a string literal'],
    ["describe('d', () => { it('n', () => {}) }, 1)", 'describe carries extra arguments'],
    ["it('n', () => {}, 'slow')", 'it carries an unsupported third argument'],
    ["it('n', () => {}, 1, 2)", 'it carries an unsupported third argument'],
    ["it('n')", 'it has no callback'],
    ['it()', 'it title is not a string literal'],
    ["it('n', 5)", 'it callback is not a function'],
    ["describe('d', () => { for (const n of [1]) it('n', () => {}) })", 'calls it outside a suite body'],
    ["const run = it\nrun('n', () => {})", 'references it outside a suite call'],
    ["test('n', () => { expect(greet('a')).toMatchObject({}) })", 'matcher toMatchObject is outside the subset'],
    ["it('n', () => { expect(1).toEqual(expect.any(Number)) })", 'uses expect.any'],
    ["it('n', async () => { await expect(Promise.reject(new Error('x'))).rejects.toThrow() })", 'uses expect(...).rejects'],
    ["it('n', () => { expect(1) })", 'calls expect without a matcher'],
    ["it('n', () => { const e = expect; e(1).toBe(1) })", 'references expect without calling it'],
    ["it('n', () => { expect(1).not.not.toBe(1) })", 'chains .not twice'],
    ["it('n', () => { const m = expect(1).toBe; m(1) })", 'references matcher toBe without calling it'],
    ["it('n', async () => { await import('node:fs') })", 'uses import()'],
    ["it('n', () => { require('node:fs') })", 'uses require'],
    ["describe('d', () => {})", 'has no it block'],
  ])('rejects %s with "%s"', (body, expected) => {
    expect(reason(`${prologue}${body}\n`)).toBe(expected)
  })

  it('rejects an import the transpiled spec still carries outside the module, named or side-effect', () => {
    expect(reason("import { it } from 'vitest'\nimport { readFileSync } from 'node:fs'\nit('n', () => { readFileSync('x') })\n")).toBe('imports node:fs')
    expect(reason("import { it } from 'vitest'\nimport 'node:fs'\nit('n', () => {})\n")).toBe('imports node:fs')
  })

  it('accepts a property named like a suite call or the assertion, which is no reference to it', () => {
    expect(reason(`${prologue}it('n', () => { const o = { it: 1, expect: 2 }; expect(o.it).toBe(1); expect(o.expect).toBe(2) })\n`)).toBe('accepted 1 case(s)')
  })
})

describe('the expect shim, run as a case program runs it', () => {
  const root = scratch
  const program = (body: string): string => `${shim}\n${body}\n`

  it('passes every matcher of the subset, negated and not, on the values vitest would accept', () => {
    const passing = program(`
class Custom extends Error {}
const cyclic = { self: undefined }
cyclic.self = cyclic
const other = { self: undefined }
other.self = other
expect(1).toBe(1)
expect(NaN).toBe(NaN)
expect({ a: 1, b: undefined }).toEqual({ a: 1 })
expect([1, { x: [2] }]).toEqual([1, { x: [2] }])
expect(new Map([[1, { a: 1 }]])).toEqual(new Map([[1, { a: 1 }]]))
expect(new Set([1, 2])).toEqual(new Set([2, 1]))
expect(new Date(5)).toEqual(new Date(5))
expect(/a/gu).toEqual(/a/gu)
expect(new Uint8Array([1, 2])).toEqual(new Uint8Array([1, 2]))
expect(new Error('m')).toEqual(new Error('m'))
expect(cyclic).toEqual(other)
expect({ a: 1 }).not.toEqual({ a: 1, b: 2 })
expect({ a: 1, b: undefined }).not.toStrictEqual({ a: 1 })
expect({ a: 1 }).toStrictEqual({ a: 1 })
expect(new Custom('m')).not.toStrictEqual(new Error('m'))
expect(undefined).toBeUndefined()
expect(null).toBeNull()
expect('x').toBeTruthy()
expect(0).toBeFalsy()
expect([1, 2]).toHaveLength(2)
expect('abc').toHaveLength(3)
expect([1, 2]).toContain(2)
expect(new Set([3])).toContain(3)
expect('hello').toContain('ell')
expect([NaN]).toContain(NaN)
expect(() => { throw new Custom('bad thing') }).toThrow()
expect(() => { throw new Custom('bad thing') }).toThrow('bad')
expect(() => { throw new Custom('bad thing') }).toThrow(/thing$/u)
expect(() => { throw new Custom('bad thing') }).toThrow(new Error('bad thing'))
expect(() => { throw new Custom('bad thing') }).toThrow(Custom)
expect(() => { throw 'plain' }).toThrow('plain')
expect(() => {}).not.toThrow()
expect('abc').toMatch(/b/u)
expect('abc').toMatch('bc')
expect(2).toBeGreaterThan(1)
expect(1).toBeLessThan(2)
expect(1).not.toBeGreaterThan(2)
`)
    const result = runProgram(root(), passing)
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it.each([
    ['expect(1).toBe(2)', 'AssertionError: expected 1 to be 2'],
    ['expect(1).not.toBe(1)', 'AssertionError: expected 1 not to be 1'],
    ['expect({ a: 1 }).toEqual({ a: 2 })', 'AssertionError: expected {"a":1} to equal {"a":2}'],
    ['expect({ a: 1, b: undefined }).toStrictEqual({ a: 1 })', 'to strictly equal'],
    ['expect([1]).toHaveLength(2)', 'AssertionError: expected [1] to have length 2'],
    ["expect('abc').toContain('z')", 'AssertionError: expected "abc" to contain "z"'],
    ['expect(5).toContain(5)', 'AssertionError: expected 5 to contain 5'],
    ['expect(() => {}).toThrow()', 'AssertionError: expected [Function anonymous] to throw'],
    ["expect(() => { throw new Error('a') }).toThrow('b')", 'to throw "b", got Error("a")'],
    ["expect(() => { throw new Error('a') }).toThrow(TypeError)", 'to throw [Function TypeError], got Error("a")'],
    ["expect(() => { throw new Error('a') }).not.toThrow()", 'AssertionError: expected [Function anonymous] not to throw'],
    ["expect('abc').toMatch(/z/u)", 'AssertionError: expected "abc" to match /z/u'],
    ['expect(1).toBeGreaterThan(1)', 'AssertionError: expected 1 to be greater than 1'],
    ['expect(2n).toBeLessThan(1n)', 'AssertionError: expected 2n to be less than 1n'],
    ['expect(1).toBeUndefined()', 'AssertionError: expected 1 to be undefined'],
    ['expect(1).toBeNull()', 'AssertionError: expected 1 to be null'],
    ['expect(0).toBeTruthy()', 'AssertionError: expected 0 to be truthy'],
    ['expect(1).toBeFalsy()', 'AssertionError: expected 1 to be falsy'],
    ['expect(5).toThrow()', 'TypeError: toThrow needs a function, got 5'],
    ['expect(5).toMatch(/5/u)', 'TypeError: toMatch needs a string, got 5'],
    ["expect(() => { throw new Error('a') }).toThrow(5)", 'TypeError: toThrow does not accept 5'],
    ['const c = {}; c.self = c; expect(c).toBe(1)', 'AssertionError: expected [object Object] to be 1'],
    ["expect(Symbol('s')).toBe(1)", 'AssertionError: expected Symbol(s) to be 1'],
    ['expect(undefined).toBe(1)', 'AssertionError: expected undefined to be 1'],
  ])('fails %s with %s', (body, message) => {
    const result = runProgram(root(), program(body))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(message)
  })
})

describe('tiers, ids, task files, READMEs, and case entries', () => {
  it('parses tier bands and refuses anything but two ascending positive integers', () => {
    expect(parseTierBands('4,12')).toEqual({ tier3From: 4, tier4From: 12 })
    for (const bad of ['4', '4,4', '0,3', 'a,b', '1,2,3', '12,4']) {
      expect(() => parseTierBands(bad)).toThrow(`--tier-bands needs two ascending positive integers, got "${bad}"`)
    }
  })

  it('assigns the tier by the exercising case count', () => {
    const bands = { tier3From: 4, tier4From: 12 }
    expect([1, 3, 4, 11, 12, 40].map(count => tierFor(count, bands))).toEqual([2, 2, 3, 3, 4, 4])
  })

  it('derives the directory and the id with the family marker', () => {
    expect(childId('greet', 'shout')).toBe('greet--shout')
    expect(taskId('greet--shout')).toBe('code:greet--implement-shout')
  })

  const input = {
    packageDir: 'greet',
    functionName: 'shout',
    source: { package: '@example/greet', module: 'packages/util/greet/src/index.ts', spec: 'packages/util/greet/tests/greet.spec.ts' },
    jsDoc: '/** Shouts. */',
    signature: 'export const shout = (text: string): string =>',
    caseCount: 5,
    bands: { tier3From: 4, tier4From: 12 },
  }

  it('writes a task file whose prompt names the file and function and hands over the documentation, never the spec', () => {
    const task = childTaskJson(input)
    expect(task).toMatchObject({
      id: 'code:greet--implement-shout',
      tier: 3,
      domain: 'repository',
      repository: input.source,
      completion: { file: 'src/index.js', function: 'shout' },
      title: 'Implement shout in @example/greet',
      heldOut: false,
      immutable: ['README.md', 'package.json'],
      checks: REPOSITORY_CHECKS,
    })
    expect(Object.keys(task)).toEqual(['id', 'tier', 'domain', 'repository', 'completion', 'title', 'prompt', 'heldOut', 'immutable', 'checks'])
    for (const phrase of ['`src/index.js`', '`packages/util/greet/src/index.ts`', '`@example/greet`', '`shout`', '/** Shouts. */\nexport const shout = (text: string): string =>', 'inputs you do not see']) {
      expect(task.prompt).toContain(phrase)
    }
    expect(task.prompt).not.toContain('greet.spec.ts')
  })

  it('writes a README with the prompt and the erased type declarations, and no type section without any', () => {
    const task = childTaskJson(input)
    const readme = childReadme(task, [{ name: 'Volume', text: "export type Volume = 'quiet' | 'loud'" }])
    expect(readme.startsWith(`# ${task.title}\n\n${task.prompt}\n\n## Types the module declares`)).toBe(true)
    expect(readme).toContain("```ts\nexport type Volume = 'quiet' | 'loud'\n```\n")
    expect(readme.endsWith('\n')).toBe(true)
    expect(childReadme(task, [])).toBe(`# ${task.title}\n\n${task.prompt}\n`)
  })

  it('writes one exit-only case entry per exercising case, id padded by ordinal', () => {
    const entries = caseEntries([{ ordinal: 7, title: 'a › b', program: 'p' }, { ordinal: 12, title: 'c', program: 'q' }])
    expect(entries).toEqual([
      { id: 'case-007', title: 'a › b', weight: 1, argv: [], stdin: 'p', exitCode: 0, stdout: '', channels: ['exit'] },
      { id: 'case-012', title: 'c', weight: 1, argv: [], stdin: 'q', exitCode: 0, stdout: '', channels: ['exit'] },
    ])
  })

  it('names every matcher the shim implements and nothing else', () => {
    for (const name of MATCHER_SUBSET) expect(shim).toContain(`${name}:`)
    expect(shim).not.toContain('toMatchObject')
  })
})

describe('parseArgs', () => {
  const defaults: FactoryOptions = {
    packagesDir: '/repo/packages/util',
    outDir: '/bench/environments-repository',
    repoRoot: '/repo',
    minLines: 1,
    bands: { tier3From: 4, tier4From: 12 },
    caseTimeoutMs: 20_000,
    dryRun: false,
    admit: false,
  }

  it('returns the defaults untouched for an empty command line', () => {
    expect(parseArgs([], defaults)).toBe(defaults)
  })

  it('reads every flag', () => {
    const parsed = parseArgs(['--packages-dir', '/p', '--out-dir', '/o', '--min-lines', '3', '--tier-bands', '2,5', '--case-timeout-ms', '100', '--dry-run'], defaults)
    expect(parsed).toEqual({ ...defaults, packagesDir: '/p', outDir: '/o', minLines: 3, bands: { tier3From: 2, tier4From: 5 }, caseTimeoutMs: 100, dryRun: true })
    expect(parseArgs(['--admit'], defaults).admit).toBe(true)
  })

  it('refuses an unknown flag, a missing value, a malformed integer, and --dry-run with --admit', () => {
    expect(() => parseArgs(['--bogus'], defaults)).toThrow('unrecognised argument "--bogus"')
    expect(() => parseArgs(['--out-dir'], defaults)).toThrow('--out-dir needs a value')
    expect(() => parseArgs(['--min-lines', '-1'], defaults)).toThrow('--min-lines needs a non-negative integer')
    expect(() => parseArgs(['--case-timeout-ms', 'soon'], defaults)).toThrow('--case-timeout-ms needs a non-negative integer')
    expect(() => parseArgs(['--dry-run', '--admit'], defaults)).toThrow('--dry-run and --admit are mutually exclusive')
  })
})

describe('the factory over a synthetic packages directory', () => {
  const factory = join(toolsDir, 'synthesize-repository-tasks.ts')

  function synthetic(): string {
    const root = scratch()
    write(root, {
      'packages/greet/package.json': JSON.stringify({ name: '@example/greet' }),
      'packages/greet/src/index.ts': MODULE_TS,
      'packages/greet/tests/greet.spec.ts': SPEC_TS,
      'packages/quiet/package.json': JSON.stringify({ name: '@example/quiet' }),
      'packages/quiet/src/index.ts': '/** Quiet. */\nexport function quiet(): number {\n  return 1\n}\n',
      'packages/quiet/tests/quiet.spec.ts': "import { expect, it, vi } from 'vitest'\nimport { quiet } from '../src/index.ts'\nit('q', () => { expect(quiet()).toBe(1) })\n",
    })
    return root
  }

  function run(args: readonly string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync(process.execPath, [factory, ...args], { cwd, encoding: 'utf8' })
    return { status: result.status, stdout: result.stdout, stderr: result.stderr }
  }

  it('lists the skip reasons and the candidates on --dry-run and writes nothing', () => {
    const root = synthetic()
    const result = run(['--dry-run', '--packages-dir', join(root, 'packages'), '--out-dir', join(root, 'out')], root)
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('quiet/src/index.ts: spec quiet.spec.ts imports vi from vitest')
    expect(result.stdout).toContain('would consider greet--greet (spec cases: 3)')
    expect(result.stdout).toContain('would consider greet--shout (spec cases: 3)')
    expect(result.stdout).toContain('would consider greet--idle (spec cases: 3)')
    expect(result.stdout).toContain('would consider greet--wrapped (spec cases: 3)')
    expect(result.stdout).not.toContain('greet--noop')
    expect(result.stdout).toContain('packages: 2, modules: 2, modules with a spec to derive from: 1')
    expect(result.stdout).toContain('candidate functions: 4')
    expect(existsSync(join(root, 'out'))).toBe(false)
  }, 60_000)

  it('writes and admits one child per exercised function, skips the unreached one, and reports the census', () => {
    const root = synthetic()
    const out = join(root, 'out')
    const result = run(['--admit', '--packages-dir', join(root, 'packages'), '--out-dir', out], root)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toContain('skip greet--idle: no case exercises idle')
    expect(result.stderr).toContain('skip greet--wrapped: no case exercises wrapped')
    expect(result.stdout).toContain('candidates: 4, skipped (no JSDoc): 2, skipped (too short): 1, skipped (no case exercises it): 2, dropped (stub did not parse): 0')
    expect(result.stdout).toContain('written: 2')
    expect(result.stdout).toContain('admitted: 2')
    expect(result.stdout).toContain('refused: 0')
    expect(JSON.parse(readFileSync(join(out, 'REFUSED.json'), 'utf8'))).toEqual([])
    const task = JSON.parse(readFileSync(join(out, 'greet--shout', 'task.json'), 'utf8')) as { id: string; tier: number; repository: { module: string } }
    expect(task.id).toBe('code:greet--implement-shout')
    expect(task.tier).toBe(2)
    expect(task.repository.module.endsWith('packages/greet/src/index.ts')).toBe(true)
    const cases = JSON.parse(readFileSync(join(out, 'greet--shout', 'reference', 'cases.json'), 'utf8')) as { id: string; title: string }[]
    expect(cases.map(one => one.title)).toEqual(['greet › nested › shouts inside the nested block', 'a top-level it works too'])
    expect(readFileSync(join(out, 'greet--shout', 'src', 'index.js'), 'utf8')).toContain(`export const shout = (text) => ${STUB_BODY};`)
    expect(readFileSync(join(out, 'greet--shout', 'README.md'), 'utf8')).toContain('## Types the module declares')
    expect(existsSync(join(out, 'greet--idle'))).toBe(false)
    expect(existsSync(join(out, 'greet--wrapped'))).toBe(false)
  }, 120_000)

  it('refuses --dry-run with --admit before touching anything', () => {
    const root = synthetic()
    const result = run(['--dry-run', '--admit', '--out-dir', join(root, 'out')], root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('--dry-run and --admit are mutually exclusive')
    expect(existsSync(join(root, 'out'))).toBe(false)
  }, 60_000)
})
