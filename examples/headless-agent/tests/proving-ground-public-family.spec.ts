import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ADMISSIBLE_LICENSES,
  analyzeTest,
  classifyLicense,
  copyrightLine,
  exportMap,
  followExport,
  isModuleFile,
  isTestFile,
  LICENSE_FILE,
  parseSourceManifest,
  publicReadme,
  publicTaskJson,
  rejectionCategory,
  resolveRelative,
  rewriteSpecifiers,
  runtimeImports,
  SHIM_FILE,
  termsFor,
  workspacePath,
} from './fixtures/proving-ground-bench/tools/public-environments.ts'
import type { PublicChildInput, PublicSource, TestContext } from './fixtures/proving-ground-bench/tools/public-environments.ts'
import { analyzeModule, MATCHER_SUBSET, transpile } from './fixtures/proving-ground-bench/tools/repository-environments.ts'

const toolsDir = fileURLToPath(new URL('./fixtures/proving-ground-bench/tools/', import.meta.url))
const shim = readFileSync(join(toolsDir, 'expect-shim.mjs'), 'utf8')
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'public-family-spec-'))
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
function runProgram(cwd: string, program: string): { status: number | null; stderr: string } {
  const result = spawnSync(process.execPath, ['--input-type=module'], { cwd, input: program, encoding: 'utf8' })
  return { status: result.status, stderr: result.stderr }
}

const MIT = `MIT License

Copyright (c) 2026 Example Author

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
`

const SOURCE: PublicSource = {
  name: 'example',
  url: 'https://github.com/example/example',
  commit: 'a'.repeat(40),
  license: 'MIT',
  licenseFile: 'LICENSE',
  licenseSha256: 'b'.repeat(64),
  root: 'src',
  directories: ['src', 'test'],
}

/** A source tree held in memory: `files` maps repository-relative paths to TypeScript or JavaScript text. */
function memoryTree(files: Record<string, string>, root = '/repo/src'): TestContext & { js: (file: string) => string } {
  const absolute = new Map(Object.entries(files).map(([path, text]) => [`/repo/${path}`, text]))
  const js = (file: string): string => transpile(absolute.get(file) as string, file)
  return {
    js,
    exportMapOf: file => (absolute.has(file) && isModuleFile(file) ? exportMap(js(file), file) : undefined),
    resolve: (from, specifier) => resolveRelative(from, specifier, path => absolute.has(path)),
    workspacePath: file => workspacePath(root, file),
    isTest: file => isTestFile(file),
  }
}

describe('licences and terms', () => {
  it('classifies each admissible licence by its own wording and nothing else', () => {
    expect(classifyLicense(MIT)).toBe('MIT')
    expect(classifyLicense('ISC License\n\nPermission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted')).toBe('ISC')
    expect(classifyLicense('Apache License\nVersion 2.0, January 2004')).toBe('Apache-2.0')
    expect(classifyLicense('Redistribution and use in source and binary forms, with or without modification, are permitted provided that ... Neither the name of the copyright holder')).toBe('BSD-3-Clause')
    expect(classifyLicense('Redistribution and use in source and binary forms, with or without modification, are permitted')).toBe('BSD-2-Clause')
    expect(classifyLicense('GNU GENERAL PUBLIC LICENSE Version 3')).toBeUndefined()
    expect(classifyLicense('')).toBeUndefined()
  })

  it('reads the copyright line and derives training-admissible terms with attribution for the admissible ids only', () => {
    expect(copyrightLine(MIT)).toBe('Copyright (c) 2026 Example Author')
    expect(copyrightLine('no notice here')).toBeUndefined()
    for (const license of ADMISSIBLE_LICENSES) {
      expect(termsFor(license)).toEqual({ purposes: ['delivery', 'training', 'evaluation'], attribution: LICENSE_FILE })
    }
    expect(termsFor('GPL-3.0-only')).toBeUndefined()
    expect(termsFor('Unlicense')).toBeUndefined()
    expect(termsFor('')).toBeUndefined()
  })
})

describe('parseSourceManifest', () => {
  const valid = { sources: [SOURCE] }

  it('parses a well-formed allowlist, normalizing its directories', () => {
    const [source] = parseSourceManifest(JSON.stringify({ sources: [{ ...SOURCE, directories: ['src/', './test'] }] }), 'sources.json')
    expect(source).toEqual({ ...SOURCE, directories: ['src', 'test'] })
  })

  it('accepts a file:// url for a local repository', () => {
    expect(parseSourceManifest(JSON.stringify({ sources: [{ ...SOURCE, url: 'file:///tmp/repo' }] }), 'sources.json')[0]?.url).toBe('file:///tmp/repo')
  })

  it.each([
    [{ sources: 'nope' }, 'expected { "sources": [...] }'],
    [{ sources: [5] }, 'source 0 is not an object'],
    [{ sources: [{ ...SOURCE, extra: 1 }] }, 'has an unknown field extra'],
    [{ sources: [{ ...SOURCE, name: 'Bad Name' }] }, 'needs name matching'],
    [{ sources: [{ ...SOURCE, commit: 'abc' }] }, 'needs commit matching'],
    [{ sources: [{ ...SOURCE, licenseSha256: 'abc' }] }, 'needs licenseSha256 matching'],
    [{ sources: [{ ...SOURCE, url: 'ftp://x' }] }, 'needs url matching'],
    [{ sources: [{ ...SOURCE, directories: [] }] }, 'needs a non-empty directories array'],
    [{ sources: [{ ...SOURCE, directories: ['/abs'] }] }, 'needs a non-empty directories array'],
    [{ sources: [SOURCE, SOURCE] }, 'repeats the name example'],
    [{ sources: [{ ...SOURCE, root: undefined }] }, 'needs root matching'],
  ])('refuses %j', (manifest, message) => {
    expect(() => parseSourceManifest(JSON.stringify(manifest), 'sources.json')).toThrow(message)
    expect(() => parseSourceManifest(JSON.stringify(valid), 'sources.json')).not.toThrow()
  })
})

describe('files and resolution', () => {
  it('tells test files from modules by the suffixes the candidate suites use', () => {
    for (const path of ['a/b.test.ts', 'a/b.spec.js', 'a/b.test.mjs', 'addDays/test.ts', 'x.test-d.ts']) expect(isTestFile(path)).toBe(true)
    for (const path of ['a/b.ts', 'a/test-helpers.ts', 'a/permutation_test.js', 'a/latest.ts']) expect(isTestFile(path)).toBe(false)
    for (const path of ['a/b.ts', 'a/b.js', 'a/b.mjs', 'a/b.tsx', 'a/permutation_test.js']) expect(isModuleFile(path)).toBe(true)
    for (const path of ['a/b.d.ts', 'a/b.test.ts', 'a/README.md', 'a/b.json']) expect(isModuleFile(path)).toBe(false)
  })

  it('maps a file under the root to src/ with the JavaScript extension, and nothing outside it', () => {
    expect(workspacePath('/repo/src', '/repo/src/array/chunk.ts')).toBe('src/array/chunk.js')
    expect(workspacePath('/repo/src', '/repo/src/util.mts')).toBe('src/util.mjs')
    expect(workspacePath('/repo/src', '/repo/src/legacy.js')).toBe('src/legacy.js')
    expect(workspacePath('/repo/src', '/repo/src/view.tsx')).toBe('src/view.js')
    expect(workspacePath('/repo/src', '/repo/test/helper.ts')).toBeUndefined()
    expect(workspacePath('/repo/src', '/repo/src')).toBeUndefined()
  })

  it('resolves the forms TypeScript and Node accept, in that order', () => {
    const files = new Set(['/repo/src/a.ts', '/repo/src/b/index.ts', '/repo/src/c.js', '/repo/src/d.mts', '/repo/src/e.tsx'])
    const isFile = (path: string): boolean => files.has(path)
    expect(resolveRelative('/repo/src/x.ts', './a', isFile)).toBe('/repo/src/a.ts')
    expect(resolveRelative('/repo/src/x.ts', './a.js', isFile)).toBe('/repo/src/a.ts')
    expect(resolveRelative('/repo/src/x.ts', './a.ts', isFile)).toBe('/repo/src/a.ts')
    expect(resolveRelative('/repo/src/x.ts', './b', isFile)).toBe('/repo/src/b/index.ts')
    expect(resolveRelative('/repo/src/x.ts', './b/index.js', isFile)).toBe('/repo/src/b/index.ts')
    expect(resolveRelative('/repo/src/x.ts', './c.js', isFile)).toBe('/repo/src/c.js')
    expect(resolveRelative('/repo/src/x.ts', './d.mjs', isFile)).toBe('/repo/src/d.mts')
    expect(resolveRelative('/repo/src/x.ts', './e.js', isFile)).toBe('/repo/src/e.tsx')
    expect(resolveRelative('/repo/src/deep/x.ts', '../a', isFile)).toBe('/repo/src/a.ts')
    expect(resolveRelative('/repo/src/x.ts', './missing', isFile)).toBeUndefined()
  })
})

describe('module imports, exports, and specifier rewriting', () => {
  const module = `import type { T } from './types'
import { helper } from './helper.js'
import { type U, other } from '../other'
import 'node:assert'
export * from './star'
export { renamed as alias } from './named.js'
export { default as fromDefault } from './def'
const local = 1
export { local, helper }
export default function main(): number { return other(helper(local)) }
export const arrow = () => 1
export const [first, second] = [1, 2]
export function declared(): void {}
export class Klass {}
`

  it('lists the runtime imports of the build, type-only ones elided, and flags dynamic ones', () => {
    const js = transpile(module, 'm.ts')
    expect(runtimeImports(js, 'm.js')).toEqual({ specifiers: ['./helper.js', '../other', 'node:assert', './star', './named.js', './def'], dynamic: false })
    expect(runtimeImports('const x = await import("./x.js")', 'd.js').dynamic).toBe(true)
    expect(runtimeImports('const x = require("./x.js")', 'r.js').dynamic).toBe(true)
  })

  it('rewrites only the specifiers the mapper answers, leaving the rest of the text byte for byte', () => {
    const js = transpile(module, 'm.ts')
    const rewritten = rewriteSpecifiers(js, 'm.js', specifier => (specifier.startsWith('.') ? `${specifier}#ws` : undefined))
    expect(rewritten).toContain('from "./helper.js#ws"')
    expect(rewritten).toContain('from "../other#ws"')
    expect(rewritten).toContain("import 'node:assert'")
    expect(rewritten).toContain('export * from "./star#ws"')
    expect(rewritten.replaceAll('#ws"', '"').replaceAll('from "', "from '").replaceAll('";', "';")).toBe(js.replaceAll('from "', "from '").replaceAll('";', "';"))
  })

  it('maps every export to a local declaration or the module it re-exports from', () => {
    const map = exportMap(transpile(module, 'm.ts'), 'm.js')
    expect(map.stars).toEqual(['./star'])
    expect(map.named.get('alias')).toEqual({ kind: 'reexport', specifier: './named.js', imported: 'renamed' })
    expect(map.named.get('fromDefault')).toEqual({ kind: 'reexport', specifier: './def', imported: 'default' })
    for (const name of ['local', 'helper', 'default', 'arrow', 'first', 'second', 'declared', 'Klass']) expect(map.named.get(name)).toEqual({ kind: 'local' })
    expect(map.named.has('main')).toBe(false)
    expect(exportMap('export * as ns from "./x.js"; export default 1;', 'n.js').named.get('ns')).toEqual({ kind: 'local' })
  })

  it('follows an export through named, default-renaming, and star re-exports to its declaring file', () => {
    const tree = memoryTree({
      'src/index.ts': "export { chunk } from './chunk'\nexport { default as mean } from './mean.js'\nexport * from './deep/index'\n",
      'src/chunk.ts': 'export function chunk(): number { return 1 }\n',
      'src/mean.ts': 'export default function mean(): number { return 2 }\n',
      'src/deep/index.ts': "export * from './leaf'\n",
      'src/deep/leaf.ts': 'export const leaf = 3\n',
      'src/loop.ts': "export * from './loop'\n",
    })
    expect(followExport('/repo/src/index.ts', 'chunk', tree)).toEqual({ file: '/repo/src/chunk.ts', name: 'chunk' })
    expect(followExport('/repo/src/index.ts', 'mean', tree)).toEqual({ file: '/repo/src/mean.ts', name: 'default' })
    expect(followExport('/repo/src/index.ts', 'leaf', tree)).toEqual({ file: '/repo/src/deep/leaf.ts', name: 'leaf' })
    expect(followExport('/repo/src/index.ts', 'absent', tree)).toBeUndefined()
    expect(followExport('/repo/src/index.ts', 'default', tree)).toBeUndefined()
    expect(followExport('/repo/src/loop.ts', 'never', tree)).toBeUndefined()
    expect(followExport('/repo/src/missing.ts', 'x', tree)).toBeUndefined()
  })
})

describe('analyzeTest', () => {
  const GREET = `/**
 * Greets a name.
 * @param name - who is greeted.
 */
export function greet(name: string): string {
  return \`hello \${name}\`
}

/** Shouts. */
export const shout = (text: string): string => {
  return \`\${text.toUpperCase()}!\`
}
`
  const tree = memoryTree({
    'src/greet.ts': GREET,
    'src/index.ts': "export { greet, shout } from './greet'\nexport { default as mean } from './stats/mean.js'\n",
    'src/stats/mean.ts': 'export default function mean(xs: number[]): number { return xs.reduce((a, b) => a + b, 0) / xs.length }\n',
    'src/fixtures.ts': "export const NAME = 'ada'\n",
    'src/greet.test.ts': '',
    'test/outside.ts': 'export const x = 1\n',
  })

  it('turns a vitest test importing a barrel into cases that import the declaring files, with drops and skips counted', () => {
    const test = `import { describe, expect, it, vi, expectTypeOf } from 'vitest'
import { greet, mean } from './index'
import { NAME } from './fixtures'
import type { Greeting } from './types'

const suffix = '!'

describe('greet', () => {
  const name = NAME
  it('greets by name', () => {
    expect(greet(name)).toBe('hello ada')
    expectTypeOf(greet(name)).toEqualTypeOf<string>()
  })
  it('is mocked', () => {
    const spy = vi.fn()
    expect(spy).toBe(spy)
  })
  it('awaits', async () => {
    await expect(Promise.resolve(1)).resolves.toBe(1)
  })
  it.each([[1]])('table %s', () => {})
  it('needs a matcher outside the subset', () => {
    expect(greet('x')).toHaveBeenCalled()
  })
  for (const value of [1, 2]) it(\`loop \${value}\`, () => { expect(value).toBe(value) })
})

it('means', () => expect(mean([1, 3])).toBe(2))
`
    const analysis = analyzeTest(transpile(test, 'greet.test.ts'), '/repo/src/greet.test.ts', tree)
    expect(analysis.kind).toBe('cases')
    if (analysis.kind !== 'cases') return
    expect(analysis.plan.framework).toBe('expect')
    expect(analysis.plan.targets).toEqual(['/repo/src/fixtures.ts', '/repo/src/greet.ts', '/repo/src/stats/mean.ts'])
    expect(analysis.plan.entries).toEqual(analysis.plan.targets)
    // Ordinals count the blocks the walk reached; a block registered through `it.each` or a loop is skipped before it is counted.
    expect(analysis.plan.cases.map(one => [one.ordinal, one.title])).toEqual([[1, 'greet › greets by name'], [5, 'means']])
    expect(analysis.plan.dropped).toEqual({ 'uses vi': 1, 'uses expect(...).resolves': 1, 'matcher toHaveBeenCalled is outside the subset': 1 })
    expect(analysis.plan.skipped).toEqual({ 'it.each': 1, 'loop registers blocks': 1 })
    const [first, second] = analysis.plan.cases
    // Imports keep the test's statement order, one line per declaring file; a body keeps the build's own indentation inside its block.
    expect(first?.program).toBe([
      `import { expect, expectTypeOf, assertType } from "./${SHIM_FILE}";`,
      'import { greet } from "./src/greet.js";',
      'import { default as mean } from "./src/stats/mean.js";',
      'import { NAME } from "./src/fixtures.js";',
      '{',
      "const suffix = '!';",
      '{',
      'const name = NAME;',
      '{',
      "expect(greet(name)).toBe('hello ada');\n        expectTypeOf(greet(name)).toEqualTypeOf();",
      '}',
      '}',
      '}',
      '',
    ].join('\n'))
    expect(second?.program).toContain('{\nexpect(mean([1, 3])).toBe(2);\n}')
  })

  it('reads a namespace import through the members the test uses and freezes them into one object', () => {
    const test = `import * as ss from './index.js'
describe('mean', () => {
  test('averages', () => {
    expect(ss.mean([2, 4])).toBe(3)
    expect(ss.greet('x')).toBe('hello x')
  })
})
`
    const analysis = analyzeTest(transpile(test, 't.test.ts'), '/repo/src/t.test.ts', tree)
    expect(analysis.kind).toBe('cases')
    if (analysis.kind !== 'cases') return
    expect(analysis.plan.targets).toEqual(['/repo/src/greet.ts', '/repo/src/stats/mean.ts'])
    const program = analysis.plan.cases[0]?.program ?? ''
    expect(program).toContain('import { greet as __ns1_greet } from "./src/greet.js";')
    expect(program).toContain('import { default as __ns1_mean } from "./src/stats/mean.js";')
    expect(program).toContain('const ss = Object.freeze({ greet: __ns1_greet, mean: __ns1_mean });')
    expect(program.startsWith(`import { expect, expectTypeOf, assertType } from "./${SHIM_FILE}";`)).toBe(true)
  })

  it('keeps a node:test suite without the shim and with its assert import verbatim', () => {
    const test = `import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { greet } from "./greet.js";
describe("greet", function () {
  it("greets", function () {
    assert.equal(greet("a"), "hello a");
  });
  it("takes the context", (t) => {
    t.diagnostic("x");
  });
});
`
    const analysis = analyzeTest(transpile(test, 'greet.test.js'), '/repo/src/greet.test.js', tree)
    expect(analysis.kind).toBe('cases')
    if (analysis.kind !== 'cases') return
    expect(analysis.plan.framework).toBe('node')
    expect(analysis.plan.dropped).toEqual({ 'block callback takes parameters': 1 })
    expect(analysis.plan.cases[0]?.program).toBe([
      'import assert from "node:assert/strict";',
      'import { greet } from "./src/greet.js";',
      '{',
      '{',
      '{',
      'assert.equal(greet("a"), "hello a");',
      '}',
      '}',
      '}',
      '',
    ].join('\n'))
  })

  it('drops every block beneath a level that registers a hook or uses vi in its own statements', () => {
    const test = `import { beforeEach, describe, expect, it, vi } from 'vitest'
import { greet } from './greet'
describe('hooked', () => {
  beforeEach(() => {})
  it('one', () => { expect(greet('a')).toBe('hello a') })
})
describe('spied', () => {
  const spy = vi.fn()
  it('two', () => { expect(spy).toBe(spy) })
})
it('three', () => { expect(greet('b')).toBe('hello b') })
`
    const analysis = analyzeTest(transpile(test, 'h.test.ts'), '/repo/src/h.test.ts', tree)
    expect(analysis.kind).toBe('cases')
    if (analysis.kind !== 'cases') return
    expect(analysis.plan.cases.map(one => one.title)).toEqual(['three'])
    expect(analysis.plan.dropped).toEqual({ 'level registers beforeEach': 1, 'uses vi': 1 })
  })

  it.each([
    ["import { greet } from './greet'\nimport fc from 'fast-check'\nit('x', () => { expect(greet(fc)).toBe('a') })", 'imports the package fast-check', 'imports a package'],
    ["import { greet } from './greet'\nimport { afterEach as after } from 'vitest'\nafter(() => greet('a'))", 'renames afterEach from vitest', 'renames a runner binding'],
    ["import { greet } from './greet'\nimport { onTestFinished } from 'vitest'\nit('x', () => { onTestFinished(() => greet('a')) })", 'imports onTestFinished from vitest', 'imports a runner binding outside the allowed set'],
    ["import vitest from 'vitest'\nimport { greet } from './greet'\nvitest.it('x', () => greet('a'))", 'imports vitest other than by named bindings', 'imports vitest other than by named bindings'],
    ["import { it } from 'vitest'\nimport { test } from 'node:test'\nimport { greet } from './greet'\nit('x', () => greet('a'))\ntest('y', () => greet('b'))", 'imports two test runners', 'imports two test runners'],
    ["import { x } from '../test/outside'\nit('x', () => { expect(x).toBe(1) })", 'lies outside the source root', 'imports outside the source root'],
    ["import { nope } from './index'\nit('x', () => { expect(nope).toBe(1) })", 'imports nope from ./index, which no module declares', 'imports outside the source root'],
    ["import { greet } from './missing'\nit('x', () => { expect(greet).toBe(1) })", 'imports ./missing, which does not resolve', 'imports outside the source root'],
    ["import './nowhere'\nit('x', () => {})", 'imports ./nowhere for its side effects, which does not resolve inside the source root', 'imports outside the source root'],
    ["import './greet.test'\nit('x', () => {})", 'imports the test file ./greet.test', 'imports another test'],
    ["import * as ns from './index'\nit('x', () => { const all = ns; expect(all).toBe(all) })", 'uses the namespace import ns other than through its members', 'uses the namespace import ns other than through its members'],
    ["import { greet } from './greet'\nconst n = greet('a')", 'has no block', 'has no block'],
    ["import { greet } from './greet'\nit('x', () => { vi.fn(greet) })", 'keeps no block: uses vi (1)', 'keeps no block'],
    ["import { describe, it } from 'vitest'\nit('x', () => {})", 'imports nothing under test', 'imports nothing under test'],
  ])('rejects %s', (test, reason, category) => {
    const analysis = analyzeTest(transpile(test, 'r.test.ts'), '/repo/src/r.test.ts', tree)
    expect(analysis).toEqual({ kind: 'rejected', reason: expect.stringContaining(reason) as string })
    if (analysis.kind === 'rejected') expect(rejectionCategory(analysis.reason)).toBe(category)
  })

  it('drops a block on its own for a nested runner reference, a non-literal title, an options object, or an expect misuse', () => {
    const test = `import { greet } from './greet'
const title = 'dynamic'
describe('outer', () => {
  it('nests', () => { it('inner', () => {}) })
  it(title, () => {})
  it('options', { timeout: 5 }, () => {})
  it('extra', () => {}, { retry: 1 })
  it('property', () => { expect.assertions(1) })
  it('bare', () => { expect(greet('a')) })
  it('uncalled', () => { expect(greet('a')).toBe })
  it('twice', () => { expect(greet('a')).not.not.toBe('x') })
  it('requires', () => { require('node:fs') })
  it('imports', async () => { await import('node:fs') })
  it('fine', () => { expect(greet('a')).toBe('hello a') }, 1000)
})
`
    const analysis = analyzeTest(transpile(test, 'd.test.ts'), '/repo/src/d.test.ts', tree)
    expect(analysis.kind).toBe('cases')
    if (analysis.kind !== 'cases') return
    expect(analysis.plan.cases.map(one => one.title)).toEqual(['outer › fine'])
    expect(analysis.plan.dropped).toEqual({
      'references it': 1,
      'it carries an unsupported third argument': 1,
      'uses expect.assertions': 1,
      'calls expect without a matcher': 1,
      'references matcher toBe without calling it': 1,
      'chains .not twice': 1,
      'uses require': 1,
      'uses import()': 1,
    })
    expect(analysis.plan.skipped).toEqual({ 'it in an unsupported form': 2 })
  })

  it('produces programs that pass against the module and fail against a stub, from a workspace holding the shim', () => {
    const root = scratch()
    const test = `import { greet, shout } from './index'
describe('greet', () => {
  it('greets', () => { expect(greet('ada')).toBe('hello ada') })
  it('shouts', () => expect(shout('a')).toBe('A!'))
})
`
    const analysis = analyzeTest(transpile(test, 'g.test.ts'), '/repo/src/g.test.ts', tree)
    expect(analysis.kind).toBe('cases')
    if (analysis.kind !== 'cases') return
    write(root, {
      'src/greet.js': transpile(GREET, 'greet.ts'),
      [SHIM_FILE]: shim,
    })
    for (const one of analysis.plan.cases) expect(runProgram(root, one.program), one.title).toEqual({ status: 0, stderr: '' })
    write(root, { 'src/greet.js': transpile(GREET, 'greet.ts').replace('return `hello ${name}`;', "throw new Error('not implemented');") })
    const [greets, shouts] = analysis.plan.cases.map(one => runProgram(root, one.program))
    expect(greets?.status).toBe(1)
    expect(greets?.stderr).toContain('Error: not implemented')
    expect(shouts).toEqual({ status: 0, stderr: '' })
  })
})

describe('the shim matchers the public family added', () => {
  const program = (body: string): string => `${shim}\n${body}\n`

  it('passes each added matcher, negated and not, on the values vitest would accept', () => {
    const result = runProgram(scratch(), program(`
class Custom extends Error {
  name = 'Custom'
}
expect(1).toBeDefined()
expect(undefined).not.toBeDefined()
expect(NaN).toBeNaN()
expect(1).not.toBeNaN()
expect('s').toBeTypeOf('string')
expect(new Custom('m')).toBeInstanceOf(Error)
expect(1).not.toBeInstanceOf(Error)
expect({ a: { b: 2 } }).toHaveProperty('a.b')
expect({ a: { b: 2 } }).toHaveProperty(['a', 'b'], 2)
expect({ a: 1 }).not.toHaveProperty('b')
expect({ a: 1 }).not.toHaveProperty('a', 2)
expect([{ a: 1 }]).toContainEqual({ a: 1 })
expect([{ a: 1 }]).not.toContainEqual({ a: 2 })
expect({ a: 1, b: { c: 2, d: 3 }, e: [1] }).toMatchObject({ b: { c: 2 }, e: [1] })
expect({ a: 1 }).not.toMatchObject({ a: 2 })
expect([{ a: 1, b: 2 }]).toMatchObject([{ a: 1 }])
expect(() => { throw new Custom('bad') }).toThrowError('bad')
expect(() => { throw new Error('Size must be positive.') }).toThrowErrorMatchingInlineSnapshot('[Error: Size must be positive.]')
expect(() => { throw new Custom('x') }).toThrowErrorMatchingInlineSnapshot(\`
  [Custom: x]
\`)
expect(2).toBeGreaterThanOrEqual(2)
expect(2).toBeLessThanOrEqual(2)
expect(1).not.toBeGreaterThanOrEqual(2)
expect(0.1 + 0.2).toBeCloseTo(0.3)
expect(0.1 + 0.2).toBeCloseTo(0.3, 5)
expect(Infinity).toBeCloseTo(Infinity)
expect(0.1).not.toBeCloseTo(0.2)
expectTypeOf(1).toEqualTypeOf()
expectTypeOf().toMatchTypeOf().not.toBeAny()
assertType(1)
`))
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it.each([
    ['expect(undefined).toBeDefined()', 'expected undefined to be defined'],
    ['expect(1).toBeNaN()', 'expected 1 to be NaN'],
    ["expect(1).toBeTypeOf('string')", 'expected 1 to be of type "string"'],
    ['expect(1).toBeInstanceOf(Error)', 'expected 1 to be an instance of [Function Error]'],
    ["expect({ a: 1 }).toHaveProperty('b')", 'expected {"a":1} to have property "b"'],
    ["expect({ a: 1 }).toHaveProperty('a', 2)", 'to have property "a" equal to 2'],
    ['expect([1]).toContainEqual(2)', 'expected [1] to contain an item equal to 2'],
    ['expect({ a: 1 }).toMatchObject({ a: 2 })', 'expected {"a":1} to match object {"a":2}'],
    ["expect(() => { throw new Error('a') }).toThrowErrorMatchingInlineSnapshot('[Error: b]')", 'to throw an error rendering as "[Error: b]", got "[Error: a]"'],
    ["expect(() => {}).toThrowErrorMatchingInlineSnapshot('[Error: b]')", 'to throw an error rendering as "[Error: b]"'],
    ['expect(1).toBeGreaterThanOrEqual(2)', 'expected 1 to be at least 2'],
    ['expect(3).toBeLessThanOrEqual(2)', 'expected 3 to be at most 2'],
    ['expect(0.1).toBeCloseTo(0.2)', 'expected 0.1 to be close to 0.2 within 2 decimal places'],
  ])('fails %s with %s', (body, message) => {
    const result = runProgram(scratch(), program(body))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(message)
  })

  it('implements every matcher the subset names', () => {
    for (const name of MATCHER_SUBSET) expect(shim).toMatch(new RegExp(`\\b${name}(?::| =)`, 'u'))
  })
})

describe('task files and READMEs', () => {
  const input: PublicChildInput = {
    provenance: {
      source: 'example',
      url: 'https://github.com/example/example',
      commit: '0123456789abcdef0123456789abcdef01234567',
      license: 'MIT',
      licenseFile: 'LICENSE',
      licenseSha256: 'b'.repeat(64),
      copyright: 'Copyright (c) 2026 Example Author',
      module: 'src/greet.ts',
      tests: ['src/greet.test.ts'],
    },
    terms: { purposes: ['delivery', 'training', 'evaluation'], attribution: LICENSE_FILE },
    functionName: 'greet',
    file: 'src/greet.js',
    jsDoc: '/** Greets. */',
    signature: 'export function greet(name: string): string',
    companions: ['src/helper.js'],
    shim: true,
    caseCount: 5,
    bands: { tier3From: 4, tier4From: 12 },
  }

  it('writes a task file whose prompt names the file, function, source, commit, and licence, hands over the documentation, and never the tests', () => {
    const task = publicTaskJson(input)
    expect(task.id).toBe('code:example--implement-greet')
    expect(task.tier).toBe(3)
    expect(task.domain).toBe('public')
    expect(task.terms).toEqual(input.terms)
    expect(task.public).toEqual(input.provenance)
    expect(task.completion).toEqual({ file: 'src/greet.js', function: 'greet' })
    expect(task.immutable).toEqual(['README.md', 'package.json', 'LICENSE', SHIM_FILE])
    expect(task.heldOut).toBe(false)
    expect(task.checks.map(check => check.id)).toEqual(['spec-cases', 'no-dependencies'])
    expect(task.prompt).toContain('`src/greet.js` is the JavaScript build of `src/greet.ts` from example (https://github.com/example/example at commit 0123456789ab, MIT licence, whose text is in `LICENSE`)')
    expect(task.prompt).toContain('/** Greets. */\nexport function greet(name: string): string')
    expect(task.prompt).toContain('The other files under `src/` (`src/helper.js`) are the module\'s own dependencies, unchanged')
    expect(task.prompt).toContain('`test/expect-shim.mjs` is the assertion library those cases run under')
    expect(task.prompt).not.toContain('greet.test')
    const bare = publicTaskJson({ ...input, companions: [], shim: false })
    expect(bare.immutable).toEqual(['README.md', 'package.json', 'LICENSE'])
    expect(bare.prompt).not.toContain('other files under')
    expect(bare.prompt).not.toContain('expect-shim')
  })

  it('writes a README with the prompt, the attribution, and the erased types when the module declares any', () => {
    const task = publicTaskJson(input)
    const readme = publicReadme(task, [{ name: 'T', text: 'export type T = string' }])
    expect(readme.startsWith('# Implement greet from example\n\n')).toBe(true)
    expect(readme).toContain('## Attribution\n\nThis task is derived from `src/greet.ts` of example (https://github.com/example/example) at commit `0123456789abcdef0123456789abcdef01234567`, distributed under the MIT licence (Copyright (c) 2026 Example Author); the licence text is kept in `LICENSE`')
    expect(readme).toContain('## Types the module declares\n\nThe module\'s TypeScript source declares these types; the JavaScript build in `src/greet.js` erased them.\n\n```ts\nexport type T = string\n```\n')
    const { copyright: _copyright, ...anonymous } = input.provenance
    const plain = publicReadme(publicTaskJson({ ...input, provenance: anonymous }), [])
    expect(plain).not.toContain('## Types')
    expect(plain).toContain('under the MIT licence; the licence text')
  })
})

describe('the factory over a local repository', () => {
  const factory = join(toolsDir, 'synthesize-public-tasks.ts')
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'spec',
    GIT_AUTHOR_EMAIL: 'spec@example.invalid',
    GIT_COMMITTER_NAME: 'spec',
    GIT_COMMITTER_EMAIL: 'spec@example.invalid',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
  }

  function git(cwd: string, ...args: string[]): string {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: gitEnv })
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
    return result.stdout.trim()
  }

  /** A committed repository with one documented module, a barrel, a vitest test through the barrel, and a `node:test` test beside it. */
  function repository(): { dir: string; commit: string; licenseSha256: string } {
    const dir = join(scratch(), 'repo')
    write(dir, {
      'LICENSE': MIT,
      'src/greet.ts': `/**
 * Greets a name.
 * @param name - who is greeted.
 */
export function greet(name: string): string {
  return \`hello \${name}\`
}

/** Idle: reached by no block. */
export function idle(): number {
  return 1
}

export function undocumented(): number {
  return 2
}
`,
      'src/stats.js': `/**
 * The sum of the numbers.
 * @param {number[]} xs the numbers
 * @returns {number} their sum
 */
function sum(xs) {
    return xs.reduce((a, b) => a + b, 0);
}

export default sum;
`,
      'src/index.ts': "export { greet, idle } from './greet'\nexport { default as sum } from './stats.js'\n",
      'src/greet.test.ts': `import { describe, expect, it } from 'vitest'
import { greet } from './index'

describe('greet', () => {
  it('greets by name', () => {
    expect(greet('ada')).toBe('hello ada')
  })
  it('keeps the case', () => {
    expect(greet('Ada')).toBe('hello Ada')
  })
  it('never held', () => {
    expect(greet('x')).toBe('wrong')
  })
})
`,
      'test/stats.test.js': `import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as lib from "../src/index.js";

describe("sum", () => {
  it("adds", () => {
    assert.equal(lib.sum([1, 2]), 3);
  });
  it("adds nothing", () => {
    assert.equal(lib.sum([]), 0);
  });
});
`,
    })
    git(dir, 'init', '-q')
    git(dir, 'add', '.')
    git(dir, 'commit', '-q', '-m', 'fixture')
    return { dir, commit: git(dir, 'rev-parse', 'HEAD'), licenseSha256: createHash('sha256').update(MIT, 'utf8').digest('hex') }
  }

  function manifest(root: string, sources: readonly Record<string, unknown>[]): string {
    const path = join(root, 'sources.json')
    writeFileSync(path, JSON.stringify({ sources }))
    return path
  }

  function run(args: readonly string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync(process.execPath, [factory, ...args], { cwd, encoding: 'utf8', env: gitEnv })
    return { status: result.status, stdout: result.stdout, stderr: result.stderr }
  }

  it('fetches the pinned commit, drops a source whose licence digest differs, and writes, admits, and censuses the children', () => {
    const root = scratch()
    const repo = repository()
    const good = {
      name: 'example', url: `file://${repo.dir}`, commit: repo.commit, license: 'MIT', licenseFile: 'LICENSE',
      licenseSha256: repo.licenseSha256, root: 'src', directories: ['src', 'test'],
    }
    const relicensed = { ...good, name: 'relicensed', licenseSha256: 'c'.repeat(64) }
    const unreachable = { ...good, name: 'unreachable', url: `file://${root}/absent` }
    const sources = manifest(root, [good, relicensed, unreachable])
    const out = join(root, 'out')
    const cache = join(root, 'cache')
    const result = run(['--sources', sources, '--cache-dir', cache, '--out-dir', out, '--admit', '--concurrency', '2'], root)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toContain('drop source relicensed: licence file LICENSE digests to')
    expect(result.stderr).toContain('drop source unreachable: git fetch failed: fatal:')
    expect(result.stderr).toContain('drop case example/src/greet.ts "src/greet.test.ts › greet › never held": the reference fails it: AssertionError: expected "hello x" to be "wrong"')
    expect(result.stderr).toContain('skip example--idle: no case exercises it')
    expect(result.stdout).toContain('source example: read, modules 3, tests 2 usable 2, candidates 3, written 2, admitted 2')
    expect(result.stdout).toContain('source relicensed: dropped (licence file LICENSE digests to')
    expect(result.stdout).toContain('written: 2')
    expect(result.stdout).toContain('admitted: 2')
    expect(result.stdout).toContain('refused: 0')
    expect(readdirSync(out).sort()).toEqual(['CENSUS.json', 'REFUSED.json', 'example--greet', 'example--sum'])
    expect(JSON.parse(readFileSync(join(out, 'REFUSED.json'), 'utf8'))).toEqual([])
    const census = JSON.parse(readFileSync(join(out, 'CENSUS.json'), 'utf8')) as {
      sources: { name: string; status: string; reason?: string; written: number; admitted: number }[]
      candidates: number
      skips: Record<string, number>
      casesDroppedByReference: number
      admittedByTier: Record<string, number>
    }
    expect(census.sources.map(one => [one.name, one.status])).toEqual([['example', 'read'], ['relicensed', 'dropped'], ['unreachable', 'dropped']])
    expect(census.candidates).toBe(3)
    expect(census.skips).toEqual({ 'no JSDoc': 1, 'no case exercises it': 1, 'too short': 0 })
    expect(census.casesDroppedByReference).toBe(1)
    expect(census.admittedByTier).toEqual({ '2': 2 })

    const greet = JSON.parse(readFileSync(join(out, 'example--greet', 'task.json'), 'utf8')) as {
      id: string
      tier: number
      public: Record<string, unknown>
      terms: unknown
      immutable: string[]
      completion: { file: string }
    }
    expect(greet.id).toBe('code:example--implement-greet')
    expect(greet.tier).toBe(2)
    expect(greet.public).toEqual({
      source: 'example', url: `file://${repo.dir}`, commit: repo.commit, license: 'MIT', licenseFile: 'LICENSE',
      licenseSha256: repo.licenseSha256, copyright: 'Copyright (c) 2026 Example Author', module: 'src/greet.ts', tests: ['src/greet.test.ts'],
    })
    expect(greet.terms).toEqual({ purposes: ['delivery', 'training', 'evaluation'], attribution: 'LICENSE' })
    expect(greet.immutable).toEqual(['README.md', 'package.json', 'LICENSE', SHIM_FILE])
    expect(readFileSync(join(out, 'example--greet', 'LICENSE'), 'utf8')).toBe(MIT)
    expect(readFileSync(join(out, 'example--greet', SHIM_FILE), 'utf8')).toBe(shim)
    expect(readFileSync(join(out, 'example--greet', 'src', 'greet.js'), 'utf8')).toContain("export function greet(name) {\n    throw new Error('not implemented');\n}")
    expect(readFileSync(join(out, 'example--greet', 'reference', 'src', 'greet.js'), 'utf8')).toContain('return `hello ${name}`;')
    expect(existsSync(join(out, 'example--greet', 'src', 'index.js'))).toBe(false)
    const cases = JSON.parse(readFileSync(join(out, 'example--greet', 'reference', 'cases.json'), 'utf8')) as { id: string; title: string; stdin: string }[]
    expect(cases.map(one => one.title)).toEqual(['src/greet.test.ts › greet › greets by name', 'src/greet.test.ts › greet › keeps the case'])
    expect(cases[0]?.stdin.startsWith(`import { expect, expectTypeOf, assertType } from "./${SHIM_FILE}";\nimport { greet } from "./src/greet.js";`)).toBe(true)

    const sum = JSON.parse(readFileSync(join(out, 'example--sum', 'task.json'), 'utf8')) as { immutable: string[]; public: { module: string; tests: string[] } }
    expect(sum.immutable).toEqual(['README.md', 'package.json', 'LICENSE'])
    expect(sum.public).toMatchObject({ module: 'src/stats.js', tests: ['test/stats.test.js'] })
    expect(existsSync(join(out, 'example--sum', SHIM_FILE))).toBe(false)
    const sumCases = JSON.parse(readFileSync(join(out, 'example--sum', 'reference', 'cases.json'), 'utf8')) as { stdin: string }[]
    expect(sumCases).toHaveLength(2)
    expect(sumCases[0]?.stdin).toContain('import { default as __ns1_sum } from "./src/stats.js";')
    expect(sumCases[0]?.stdin).toContain('const lib = Object.freeze({ sum: __ns1_sum });')
    expect(readFileSync(join(out, 'example--sum', 'README.md'), 'utf8')).not.toContain('## Types')

    // A second run reuses the fetched commit and reproduces the same output.
    const again = run(['--sources', sources, '--cache-dir', cache, '--out-dir', out, '--admit', '--concurrency', '2'], root)
    expect(again.status, again.stderr).toBe(0)
    expect(readFileSync(join(out, 'CENSUS.json'), 'utf8')).toBe(JSON.stringify(census, null, 2) + '\n')
  }, 180_000)

  it('lists the candidates on --dry-run without fetching twice or writing, and refuses --dry-run with --admit and an unknown --only', () => {
    const root = scratch()
    const repo = repository()
    const sources = manifest(root, [{
      name: 'example', url: `file://${repo.dir}`, commit: repo.commit, license: 'MIT', licenseFile: 'LICENSE',
      licenseSha256: repo.licenseSha256, root: 'src', directories: ['src', 'test'],
    }])
    const out = join(root, 'out')
    const dry = run(['--dry-run', '--sources', sources, '--cache-dir', join(root, 'cache'), '--out-dir', out], root)
    expect(dry.status, dry.stderr).toBe(0)
    expect(dry.stdout).toContain('would consider example--greet (src/greet.ts, 1 test(s), 3 cases)')
    expect(dry.stdout).toContain('would consider example--idle (src/greet.ts, 1 test(s), 3 cases)')
    expect(dry.stdout).toContain('would consider example--sum (src/stats.js, 1 test(s), 2 cases)')
    expect(dry.stdout).toContain('modules: 3, tests: 2, candidates: 3')
    expect(existsSync(out)).toBe(false)
    const both = run(['--dry-run', '--admit', '--sources', sources, '--out-dir', out], root)
    expect(both.status).toBe(1)
    expect(both.stderr).toContain('--dry-run and --admit are mutually exclusive')
    const unknown = run(['--dry-run', '--only', 'nope', '--sources', sources, '--out-dir', out], root)
    expect(unknown.status).toBe(1)
    expect(unknown.stderr).toContain('--only names sources the allowlist lacks: nope')
    expect(existsSync(out)).toBe(false)
  }, 120_000)
})

describe('analyzeModule on the forms public sources use', () => {
  it('locates a function exported by a later statement and inherits the first overload\'s JSDoc', () => {
    const analysis = analyzeModule(`/**
 * Mean.
 */
function mean(xs) {
    return xs[0];
}
function helper() {
    return 1;
}
export default mean;

/** Parse or format. */
export function ms(value: string): number
export function ms(value: number): string
export function ms(value: string | number): number | string {
  return value
}
`, 'mean.ts')
    expect(analysis.functions.map(fn => [fn.name, fn.jsDoc])).toEqual([['mean', '/**\n * Mean.\n */'], ['ms', '/** Parse or format. */']])
    expect(analysis.functions[1]?.signature).toBe('export function ms(value: string | number): number | string')
  })
})
