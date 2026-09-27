/**
 * The pure half of the public-repository environment factory
 * (`synthesize-public-tasks.ts`): every decision that needs no network, file
 * system, or subprocess, so a unit test can pin each one. It reads the source
 * allowlist, classifies a licence text and the data-use terms it admits,
 * resolves a module's relative imports and the re-exports of a barrel, rewrites
 * import specifiers to a child workspace's paths, and turns one test file into
 * hidden cases the way the repository factory does, generalized to the forms
 * public suites take: `vitest` or `@jest/globals` imports or bare globals with
 * the matcher subset `expect-shim.mjs` implements, or `node:test` with
 * `node:assert`; a test importing several modules, a barrel, or a namespace;
 * and a block the shim cannot run dropped on its own rather than with its
 * whole file.
 *
 * A case program is the shim import (for an `expect` suite), the test's
 * imports rewritten to the workspace, a frozen object per namespace import,
 * and then one block per level as the repository factory assembles them: the
 * top level's other statements, one nested block per enclosing `describe`
 * holding that level's other statements, innermost of which holds the `it`
 * body. The shim is imported from `test/expect-shim.mjs` in the workspace
 * rather than inlined, so a case is a few hundred bytes and the file that
 * decides an assertion is immutable and visible to the implementer, who learns
 * nothing about the cases from it.
 */

import { isBuiltin } from 'node:module'
import { posix } from 'node:path'
import ts from 'typescript'
import { childId, literalText, MATCHER_SUBSET, parseSource, taskId, tierFor } from './repository-environments.ts'
import type { ModuleType, RepositoryCheckFile, TierBands } from './repository-environments.ts'

// --- Sources and licences ------------------------------------------------------------

/**
 * The licences whose terms admit a derived task as training material with
 * attribution kept: each requires the copyright notice and licence text to
 * accompany copies, and nothing more of a derived work. Every other licence,
 * and no licence, excludes the source before a child is written.
 */
export const ADMISSIBLE_LICENSES: ReadonlySet<string> = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0'])

/** The purposes a `dsh-data-use` record may name, in the order the terms list them. */
const ALL_PURPOSES: readonly ['delivery', 'training', 'evaluation'] = ['delivery', 'training', 'evaluation']

/** The data-use terms a child's licence admits, in the vocabulary of `@deepseek-ai/dsh-data-use`. */
export interface DataUseTerms {
  /** Every purpose the licence admits; an admissible licence admits all three. */
  readonly purposes: readonly ('delivery' | 'training' | 'evaluation')[]
  /** The workspace path of the licence copy that must travel with the task and anything derived from it. */
  readonly attribution: string
}

/** The workspace path every public child keeps its source's licence text at. */
export const LICENSE_FILE = 'LICENSE'

/**
 * The terms a licence admits.
 * @param license - the SPDX id the allowlist declares.
 * @returns the terms, or `undefined` for a licence outside {@link ADMISSIBLE_LICENSES}.
 */
export function termsFor(license: string): DataUseTerms | undefined {
  return ADMISSIBLE_LICENSES.has(license) ? { purposes: ALL_PURPOSES, attribution: LICENSE_FILE } : undefined
}

/**
 * The SPDX id a licence text's own wording names, from the phrases each
 * licence carries and no other admissible one does. The factory refuses a
 * source whose declared id disagrees with its text.
 * @param text - the licence file's text.
 * @returns the id, or `undefined` for a text this recognizes as none of them.
 */
export function classifyLicense(text: string): string | undefined {
  const flat = text.replace(/\s+/gu, ' ')
  if (/Permission is hereby granted, free of charge, to any person obtaining a copy/u.test(flat)) return 'MIT'
  if (/Permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee/u.test(flat)) return 'ISC'
  if (/Apache License,? Version 2\.0/u.test(flat)) return 'Apache-2.0'
  if (/Redistribution and use in source and binary forms/u.test(flat)) {
    return /Neither the name of/u.test(flat) ? 'BSD-3-Clause' : 'BSD-2-Clause'
  }
  return undefined
}

/**
 * The first copyright line of a licence text, which a derived work's
 * attribution repeats.
 * @param text - the licence file's text.
 * @returns the line, trimmed, or `undefined` when the text names none.
 */
export function copyrightLine(text: string): string | undefined {
  return text.split('\n').map(line => line.trim()).find(line => /^copyright\b/iu.test(line))
}

/** One source repository the allowlist names, as `public-sources.json` declares it. */
export interface PublicSource {
  /** The child directory prefix; lower-case letters, digits, and single hyphens. */
  readonly name: string
  /** The repository's clone URL: `https://` for a public host, `file://` for a local repository under test. */
  readonly url: string
  /** The full commit hash the factory fetches; nothing else is ever read. */
  readonly commit: string
  /** The SPDX id of the repository's licence. */
  readonly license: string
  /** The licence file's repository-relative path. */
  readonly licenseFile: string
  /** SHA-256 of the licence file at the pinned commit, so a relicensed source is refused rather than read. */
  readonly licenseSha256: string
  /** The repository-relative directory mirrored into a child's `src/`; a module outside it disqualifies its test. */
  readonly root: string
  /** The repository-relative directories the factory reads for modules and tests. */
  readonly directories: readonly string[]
}

const SOURCE_FIELDS: readonly (keyof PublicSource)[] = ['name', 'url', 'commit', 'license', 'licenseFile', 'licenseSha256', 'root', 'directories']

function sourceError(fileName: string, index: number, problem: string): Error {
  return new Error(`${fileName}: source ${index} ${problem}`)
}

/**
 * The allowlist, validated at the file boundary: every field present and of
 * its form, names unique, and no field this module does not read.
 * @param text - the JSON text of `public-sources.json`.
 * @param fileName - the file's name, for the error.
 * @returns the sources in file order.
 * @throws on any malformed entry.
 */
export function parseSourceManifest(text: string, fileName: string): PublicSource[] {
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { sources?: unknown }).sources)) {
    throw new Error(`${fileName}: expected { "sources": [...] }`)
  }
  const sources: PublicSource[] = []
  const names = new Set<string>()
  const entries = (parsed as { sources: unknown[] }).sources
  entries.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw sourceError(fileName, index, 'is not an object')
    const fields = entry as Record<string, unknown>
    for (const key of Object.keys(fields)) {
      if (!SOURCE_FIELDS.includes(key as keyof PublicSource)) throw sourceError(fileName, index, `has an unknown field ${key}`)
    }
    const string = (key: keyof PublicSource, pattern: RegExp): string => {
      const value = fields[key]
      if (typeof value !== 'string' || !pattern.test(value)) throw sourceError(fileName, index, `needs ${key} matching ${pattern}`)
      return value
    }
    const name = string('name', /^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
    if (names.has(name)) throw sourceError(fileName, index, `repeats the name ${name}`)
    names.add(name)
    const directories = fields.directories
    if (!Array.isArray(directories) || directories.length === 0 || !directories.every(one => typeof one === 'string' && /^[^\0]+$/u.test(one) && !one.startsWith('/'))) {
      throw sourceError(fileName, index, 'needs a non-empty directories array of repository-relative paths')
    }
    sources.push({
      name,
      url: string('url', /^(?:https|file):\/\/[^\s]+$/u),
      commit: string('commit', /^[0-9a-f]{40}$/u),
      license: string('license', /^[A-Za-z0-9.-]+$/u),
      licenseFile: string('licenseFile', /^[^\0/][^\0]*$/u),
      licenseSha256: string('licenseSha256', /^[0-9a-f]{64}$/u),
      root: string('root', /^[^\0/][^\0]*$|^\.$/u),
      directories: directories.map(one => posix.normalize(one as string).replace(/(?<=.)\/+$/u, '')),
    })
  })
  return sources
}

// --- Files and resolution ---------------------------------------------------------------

/**
 * Whether a path names a test file, by the suffixes the candidate suites use:
 * `.test.*`, `.spec.*`, a bare `test.*`, and vitest's `.test-d.*` type tests.
 */
export function isTestFile(path: string): boolean {
  return /(?:\.(?:test|spec)|(?:^|\/)test)\.[cm]?[jt]sx?$/u.test(path) || /\.test-d\.[cm]?tsx?$/u.test(path)
}

/** Whether a path names a module the factory may read: a JavaScript or TypeScript source that is neither a declaration nor a test. */
export function isModuleFile(path: string): boolean {
  return /\.[cm]?[jt]sx?$/u.test(path) && !/\.d\.[cm]?ts$/u.test(path) && !isTestFile(path)
}

/**
 * The workspace path a source file is emitted at: `src/` plus its path under
 * the source root, with the TypeScript extension turned into the JavaScript
 * one the build would emit.
 * @param root - the source root, as an absolute or repository-relative POSIX path.
 * @param file - the file, in the same form.
 * @returns the workspace path, or `undefined` for a file outside the root.
 */
export function workspacePath(root: string, file: string): string | undefined {
  const relative = posix.relative(root, file)
  if (relative === '' || relative.startsWith('..') || posix.isAbsolute(relative)) return undefined
  return posix.join('src', relative.replace(/\.mts$/u, '.mjs').replace(/\.cts$/u, '.cjs').replace(/\.tsx?$/u, '.js'))
}

/**
 * Resolves a relative specifier the way TypeScript and Node both accept: as
 * written, with a source extension appended, with a `.js` extension read as
 * its `.ts` source, or as a directory's index.
 * @param fromFile - the importing file's path.
 * @param specifier - the relative specifier.
 * @param isFile - whether a path names an existing file.
 * @returns the resolved file, or `undefined`.
 */
export function resolveRelative(fromFile: string, specifier: string, isFile: (path: string) => boolean): string | undefined {
  const base = posix.join(posix.dirname(fromFile), specifier)
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.js`,
    `${base}.mjs`,
    base.replace(/\.js$/u, '.ts'),
    base.replace(/\.js$/u, '.tsx'),
    base.replace(/\.mjs$/u, '.mts'),
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.mjs`,
  ]
  return candidates.find(candidate => isFile(candidate))
}

/** What one JavaScript build imports at runtime, after type-only imports were elided. */
export interface RuntimeImports {
  /** Every import and re-export specifier, in source order, each once. */
  readonly specifiers: readonly string[]
  /** Whether the module calls `import()` or `require()`, which a static closure cannot follow. */
  readonly dynamic: boolean
}

/**
 * The runtime imports of one transpiled module.
 * @param js - the module's JavaScript.
 * @param fileName - the module's name, for the parser.
 * @returns the specifiers and whether any import is dynamic.
 */
export function runtimeImports(js: string, fileName: string): RuntimeImports {
  const file = parseSource(js, fileName)
  const specifiers: string[] = []
  let dynamic = false
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!specifiers.includes(node.moduleSpecifier.text)) specifiers.push(node.moduleSpecifier.text)
      return
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) dynamic = true
      if (ts.isIdentifier(node.expression) && node.expression.text === 'require') dynamic = true
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return { specifiers, dynamic }
}

/**
 * The module's JavaScript with every import and re-export specifier passed
 * through `rewrite`; a specifier `rewrite` answers `undefined` for stays.
 * @param js - the module's JavaScript.
 * @param fileName - the module's name, for the parser.
 * @param rewrite - the replacement for one specifier, or `undefined` to keep it.
 * @returns the rewritten JavaScript.
 */
export function rewriteSpecifiers(js: string, fileName: string, rewrite: (specifier: string) => string | undefined): string {
  const file = parseSource(js, fileName)
  const edits: { start: number; end: number; text: string }[] = []
  for (const statement of file.statements) {
    if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))) continue
    const specifier = statement.moduleSpecifier
    if (specifier === undefined || !ts.isStringLiteral(specifier)) continue
    const replacement = rewrite(specifier.text)
    if (replacement !== undefined) edits.push({ start: specifier.getStart(file), end: specifier.end, text: JSON.stringify(replacement) })
  }
  let out = js
  for (const edit of edits.reverse()) out = `${out.slice(0, edit.start)}${edit.text}${out.slice(edit.end)}`
  return out
}

/** Where one export of a module comes from. */
type ExportBinding =
  | { readonly kind: 'local' }
  | { readonly kind: 'reexport'; readonly specifier: string; readonly imported: string }

/** The exports one JavaScript build declares, by exported name, plus the modules it re-exports wholesale. */
export interface ExportMap {
  readonly named: ReadonlyMap<string, ExportBinding>
  readonly stars: readonly string[]
}

/**
 * The export map of one transpiled module.
 * @param js - the module's JavaScript.
 * @param fileName - the module's name, for the parser.
 * @returns every named export with its origin, and the `export *` specifiers.
 */
export function exportMap(js: string, fileName: string): ExportMap {
  const file = parseSource(js, fileName)
  const named = new Map<string, ExportBinding>()
  const stars: string[] = []
  const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
    ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(modifier => modifier.kind === kind)
  const exported = (node: ts.Node): boolean => hasModifier(node, ts.SyntaxKind.ExportKeyword)
  const isDefault = (node: ts.Node): boolean => hasModifier(node, ts.SyntaxKind.DefaultKeyword)
  for (const statement of file.statements) {
    if (ts.isExportAssignment(statement)) {
      named.set('default', { kind: 'local' })
      continue
    }
    if (ts.isExportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : undefined
      if (statement.exportClause === undefined) {
        if (specifier !== undefined) stars.push(specifier)
        continue
      }
      if (ts.isNamespaceExport(statement.exportClause)) {
        named.set(statement.exportClause.name.text, { kind: 'local' })
        continue
      }
      for (const element of statement.exportClause.elements) {
        const imported = (element.propertyName ?? element.name).text
        named.set(element.name.text, specifier === undefined ? { kind: 'local' } : { kind: 'reexport', specifier, imported })
      }
      continue
    }
    if (!exported(statement)) continue
    if (isDefault(statement)) named.set('default', { kind: 'local' })
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))
      && statement.name !== undefined && !isDefault(statement)) {
      named.set(statement.name.text, { kind: 'local' })
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) named.set(declaration.name.text, { kind: 'local' })
        else for (const name of bindingNames(declaration.name)) named.set(name, { kind: 'local' })
      }
    }
  }
  return { named, stars }
}

function bindingNames(pattern: ts.BindingName): string[] {
  if (ts.isIdentifier(pattern)) return [pattern.text]
  const names: string[] = []
  for (const element of pattern.elements) {
    if (ts.isBindingElement(element)) names.push(...bindingNames(element.name))
  }
  return names
}

/** The file that declares one export and the name it carries there. */
export interface ExportTarget {
  readonly file: string
  readonly name: string
}

/** What {@link followExport} needs from the source tree. */
export interface ExportResolver {
  /** The export map of a file, or `undefined` when the file cannot be read as a module. */
  readonly exportMapOf: (file: string) => ExportMap | undefined
  /** Resolves a relative specifier from a file, or `undefined`. */
  readonly resolve: (fromFile: string, specifier: string) => string | undefined
}

/**
 * The declaring file of `name` as exported by `file`, followed through
 * `export { x } from`, `export { default as x } from`, and `export * from`
 * chains up to eight modules deep.
 * @param file - the module the importer names.
 * @param name - the exported name, `default` for the default export.
 * @param resolver - the source tree.
 * @param depth - the chain length so far; callers pass nothing.
 * @returns the target, or `undefined` when no module in the chain declares the name.
 */
export function followExport(file: string, name: string, resolver: ExportResolver, depth = 0): ExportTarget | undefined {
  if (depth > 8) return undefined
  const map = resolver.exportMapOf(file)
  if (map === undefined) return undefined
  const binding = map.named.get(name)
  if (binding?.kind === 'local') return { file, name }
  if (binding?.kind === 'reexport') {
    const next = resolver.resolve(file, binding.specifier)
    return next === undefined ? undefined : followExport(next, binding.imported, resolver, depth + 1)
  }
  if (name === 'default') return undefined
  for (const specifier of map.stars) {
    const next = resolver.resolve(file, specifier)
    const found = next === undefined ? undefined : followExport(next, name, resolver, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

// --- Test analysis -------------------------------------------------------------------

/** The test runner a test file is written for: the `expect` family (vitest, jest, or their globals) or `node:test`. */
type Framework = 'expect' | 'node'

/** The modules whose bindings a test may import as its runner, and the bindings each may supply. */
const EXPECT_MODULES: ReadonlySet<string> = new Set(['vitest', '@jest/globals'])
const EXPECT_BINDINGS: ReadonlySet<string> = new Set(['describe', 'it', 'test', 'suite', 'expect', 'vi', 'expectTypeOf', 'assertType', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll'])
const NODE_MODULES: ReadonlySet<string> = new Set(['node:test', 'test'])
const NODE_BINDINGS: ReadonlySet<string> = new Set(['describe', 'it', 'test', 'suite', 'mock', 'before', 'after', 'beforeEach', 'afterEach'])
const SUITE_NAMES: ReadonlySet<string> = new Set(['describe', 'suite'])
const BLOCK_NAMES: ReadonlySet<string> = new Set(['it', 'test'])
const HOOK_NAMES: ReadonlySet<string> = new Set(['beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'before', 'after'])

/** The workspace path of the shim and the import line every `expect` case starts with. */
export const SHIM_FILE = 'test/expect-shim.mjs'
const SHIM_IMPORT = `import { expect, expectTypeOf, assertType } from ${JSON.stringify(`./${SHIM_FILE}`)};`

/** What {@link analyzeTest} needs from the source tree beyond the test itself. */
export interface TestContext extends ExportResolver {
  /** The workspace path of a source file, or `undefined` for one outside the source root. */
  readonly workspacePath: (file: string) => string | undefined
  /** Whether a source file is a test file, which a test may not import. */
  readonly isTest: (file: string) => boolean
}

/** One hidden case a test yields. */
export interface TestCase {
  /** 1-based position among the test's blocks, in source order, counting dropped ones. */
  readonly ordinal: number
  /** The `describe` titles and the block title, joined by ` › `. */
  readonly title: string
  readonly program: string
}

/** The cases one test file yields, what it imports, and what it set aside. */
export interface TestPlan {
  readonly framework: Framework
  readonly cases: readonly TestCase[]
  /** The source files whose exports the test imports directly, after barrels are followed: the modules it judges. */
  readonly targets: readonly string[]
  /** Every source file the test imports, followed through barrels: what the workspace must hold beside the modules' own closure. */
  readonly entries: readonly string[]
  /** Blocks dropped on their own, by reason. */
  readonly dropped: Readonly<Record<string, number>>
  /** Statements registering blocks in a form the walk does not turn into cases, by form. */
  readonly skipped: Readonly<Record<string, number>>
}

/** Either the plan a test yields or why it yields none. */
export type TestAnalysis =
  | { readonly kind: 'cases'; readonly plan: TestPlan }
  | { readonly kind: 'rejected'; readonly reason: string }

class TestRejection extends Error {}

/** One `describe` level or the test's top level: its title path, its own statements, and the reason it is unusable, if any. */
interface Level {
  readonly prelude: readonly string[]
  readonly problem: string | undefined
}

interface CollectedCase {
  readonly ordinal: number
  readonly titles: readonly string[]
  readonly levels: readonly Level[]
  /** The callback's block body, or its expression body, which the program runs as one statement. */
  readonly body: ts.Node
  readonly parameters: number
  readonly extra: string | undefined
}

function tally(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1
}

function calleeName(call: ts.CallExpression): string | undefined {
  return ts.isIdentifier(call.expression) ? call.expression.text : undefined
}

/** The runner name a `describe.each(...)`, `it.skip(...)`, or `test.each(...)(...)` form is built on, for the census. */
function modifiedForm(call: ts.CallExpression): string | undefined {
  const head = ts.isCallExpression(call.expression) ? call.expression.expression : call.expression
  if (ts.isPropertyAccessExpression(head) && ts.isIdentifier(head.expression) && isRunnerName(head.expression.text)) {
    return `${head.expression.text}.${head.name.text}`
  }
  return undefined
}

function isRunnerName(name: string | undefined): boolean {
  return name !== undefined && (SUITE_NAMES.has(name) || BLOCK_NAMES.has(name))
}

function mentionsSuiteCall(node: ts.Node): boolean {
  let found = false
  const visit = (inner: ts.Node): void => {
    if (found) return
    if (ts.isCallExpression(inner) && (isRunnerName(calleeName(inner)) || modifiedForm(inner) !== undefined)) {
      found = true
      return
    }
    ts.forEachChild(inner, visit)
  }
  visit(node)
  return found
}

/**
 * Splits each level's statements into blocks, describes, hooks, skipped
 * forms, and the rest, descending into every `describe`.
 */
class Walker {
  readonly cases: CollectedCase[] = []
  readonly skipped: Record<string, number> = {}
  private ordinal = 0
  private readonly file: ts.SourceFile
  private readonly check: (node: ts.Node) => string | undefined

  constructor(file: ts.SourceFile, check: (node: ts.Node) => string | undefined) {
    this.file = file
    this.check = check
  }

  walk(statements: readonly ts.Statement[], levels: readonly Level[], titles: readonly string[]): void {
    const suiteCalls: ts.CallExpression[] = []
    const prelude: string[] = []
    let problem: string | undefined
    for (const statement of statements) {
      const call = ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) ? statement.expression : undefined
      if (call !== undefined) {
        const name = calleeName(call)
        if (isRunnerName(name)) {
          suiteCalls.push(call)
          continue
        }
        if (name !== undefined && HOOK_NAMES.has(name)) {
          problem ??= `level registers ${name}`
          continue
        }
        const form = modifiedForm(call)
        if (form !== undefined) {
          tally(this.skipped, form)
          continue
        }
      }
      if (ts.isIterationStatement(statement, false) && mentionsSuiteCall(statement)) {
        tally(this.skipped, 'loop registers blocks')
        continue
      }
      problem ??= this.check(statement)
      prelude.push(statement.getText(this.file))
    }
    const current = [...levels, { prelude, problem }]
    for (const call of suiteCalls) this.suite(call, current, titles)
  }

  private suite(call: ts.CallExpression, levels: readonly Level[], titles: readonly string[]): void {
    const kind = calleeName(call) as string
    const [titleNode, second, third] = call.arguments
    const title = titleNode === undefined ? undefined : literalText(titleNode)
    const callback = second !== undefined && (ts.isArrowFunction(second) || ts.isFunctionExpression(second)) ? second : undefined
    if (SUITE_NAMES.has(kind)) {
      const usable = title !== undefined && callback !== undefined && ts.isBlock(callback.body)
        && callback.parameters.length === 0 && third === undefined
      if (!usable) {
        tally(this.skipped, `${kind} in an unsupported form`)
        return
      }
      this.walk(callback.body.statements, levels, [...titles, title])
      return
    }
    this.ordinal += 1
    if (title === undefined || callback === undefined) {
      tally(this.skipped, `${kind} in an unsupported form`)
      return
    }
    const extra = third !== undefined && !ts.isNumericLiteral(third) ? `${kind} carries an unsupported third argument` : undefined
    this.cases.push({
      ordinal: this.ordinal,
      titles: [...titles, title],
      levels,
      body: callback.body,
      parameters: callback.parameters.length,
      extra,
    })
  }
}

/** The first construct in `node` a case of the given framework cannot run, or `undefined`. */
function unsupportedConstruct(node: ts.Node, framework: Framework): string | undefined {
  let problem: string | undefined
  const visit = (inner: ts.Node): void => {
    if (problem !== undefined) return
    if (ts.isCallExpression(inner) && inner.expression.kind === ts.SyntaxKind.ImportKeyword) {
      problem = 'uses import()'
      return
    }
    if (ts.isIdentifier(inner)) {
      const parent = inner.parent
      const namesMember = ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)
      if (namesMember && parent.name === inner) return
      if (ts.isBindingElement(parent) || ts.isParameter(parent) || ts.isVariableDeclaration(parent) && parent.name === inner) return
      const text = inner.text
      const call = ts.isCallExpression(parent) && parent.expression === inner ? parent : undefined
      const access = ts.isPropertyAccessExpression(parent) && parent.expression === inner ? parent : undefined
      if (text === 'require' && call !== undefined) problem = 'uses require'
      else if (SUITE_NAMES.has(text) || BLOCK_NAMES.has(text) || HOOK_NAMES.has(text)) problem = `references ${text}`
      else if (framework === 'expect' && text === 'vi') problem = 'uses vi'
      else if (framework === 'node' && text === 'mock') problem = 'uses mock'
      else if (framework === 'expect' && text === 'expect') {
        if (access !== undefined) problem = `uses expect.${access.name.text}`
        else if (call === undefined) problem = 'references expect without calling it'
        else problem = expectChainProblem(call)
      }
      if (problem !== undefined) return
    }
    ts.forEachChild(inner, visit)
  }
  visit(node)
  return problem
}

/** Why an `expect(...)` chain is outside the shim: `.not` at most once, then one subset matcher, called. */
function expectChainProblem(call: ts.CallExpression): string | undefined {
  let cursor: ts.Node = call
  let negated = false
  for (;;) {
    const access = cursor.parent
    if (!ts.isPropertyAccessExpression(access) || access.expression !== cursor) return 'calls expect without a matcher'
    const name = access.name.text
    if (name === 'not') {
      if (negated) return 'chains .not twice'
      negated = true
      cursor = access
      continue
    }
    if (name === 'resolves' || name === 'rejects') return `uses expect(...).${name}`
    if (!MATCHER_SUBSET.has(name)) return `matcher ${name} is outside the subset`
    const matcherCall = access.parent
    if (!ts.isCallExpression(matcherCall) || matcherCall.expression !== access) return `references matcher ${name} without calling it`
    return undefined
  }
}

/** One import the case program keeps, rewritten to the workspace, or the const a namespace import becomes. */
interface ImportPlan {
  readonly framework: Framework | undefined
  readonly lines: string[]
  readonly targets: Set<string>
  readonly entries: Set<string>
}

/** The member names a namespace import's identifier is read through, or `undefined` when it is used any other way. */
function namespaceMembers(file: ts.SourceFile, name: string): Set<string> | undefined {
  const members = new Set<string>()
  let other = false
  const visit = (node: ts.Node): void => {
    if (other) return
    if (ts.isIdentifier(node) && node.text === name && !ts.isImportSpecifier(node.parent) && !ts.isNamespaceImport(node.parent)) {
      const parent = node.parent
      if ((ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent)) && parent.name === node) return
      if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
        members.add(parent.name.text)
        return
      }
      other = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return other ? undefined : members
}

/**
 * Rewrites the test's imports: runner imports are dropped and set the
 * framework, `node:` built-ins are kept, and relative imports are followed
 * through barrels to the declaring files and re-pointed at the workspace, a
 * namespace import becoming a frozen object of the members the test reads.
 */
function planImports(file: ts.SourceFile, fileName: string, context: TestContext): ImportPlan {
  const plan: ImportPlan = { framework: undefined, lines: [], targets: new Set(), entries: new Set() }
  const builtins: string[] = []
  const namespaces: string[] = []
  let framework: Framework | undefined
  const target = (from: string, specifier: string, name: string): { file: string; name: string; path: string } => {
    const resolved = context.resolve(from, specifier)
    if (resolved === undefined) throw new TestRejection(`imports ${specifier}, which does not resolve`)
    if (context.isTest(resolved)) throw new TestRejection(`imports the test file ${specifier}`)
    const found = followExport(resolved, name, context)
    if (found === undefined) throw new TestRejection(`imports ${name === 'default' ? 'the default export' : name} from ${specifier}, which no module declares`)
    const path = context.workspacePath(found.file)
    if (path === undefined) throw new TestRejection(`imports ${found.file}, which lies outside the source root`)
    return { ...found, path }
  }
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const specifier = statement.moduleSpecifier.text
    const clause = statement.importClause
    if (EXPECT_MODULES.has(specifier) || NODE_MODULES.has(specifier)) {
      const wanted = EXPECT_MODULES.has(specifier) ? 'expect' : 'node'
      if (framework !== undefined && framework !== wanted) throw new TestRejection('imports two test runners')
      framework = wanted
      const allowed = wanted === 'expect' ? EXPECT_BINDINGS : NODE_BINDINGS
      const named = clause !== undefined && clause.name === undefined && clause.namedBindings !== undefined
        && ts.isNamedImports(clause.namedBindings)
      if (!named) {
        throw new TestRejection(`imports ${specifier} other than by named bindings`)
      }
      for (const element of clause.namedBindings.elements) {
        if (element.propertyName !== undefined) throw new TestRejection(`renames ${element.propertyName.text} from ${specifier}`)
        if (!allowed.has(element.name.text)) throw new TestRejection(`imports ${element.name.text} from ${specifier}`)
      }
      continue
    }
    if (isBuiltin(specifier)) {
      builtins.push(statement.getText(file))
      continue
    }
    if (!specifier.startsWith('.')) throw new TestRejection(`imports the package ${specifier}`)
    if (clause === undefined) {
      const resolved = context.resolve(fileName, specifier)
      const path = resolved === undefined ? undefined : context.workspacePath(resolved)
      if (resolved === undefined || path === undefined) throw new TestRejection(`imports ${specifier} for its side effects, which does not resolve inside the source root`)
      if (context.isTest(resolved)) throw new TestRejection(`imports the test file ${specifier}`)
      plan.entries.add(resolved)
      plan.lines.push(`import ${JSON.stringify(`./${path}`)};`)
      continue
    }
    const byPath = new Map<string, string[]>()
    const add = (found: { file: string; name: string; path: string }, local: string): void => {
      plan.targets.add(found.file)
      plan.entries.add(found.file)
      const list = byPath.get(found.path) ?? []
      list.push(found.name === local ? local : `${found.name} as ${local}`)
      byPath.set(found.path, list)
    }
    if (clause.name !== undefined) add(target(fileName, specifier, 'default'), clause.name.text)
    const bindings = clause.namedBindings
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        add(target(fileName, specifier, (element.propertyName ?? element.name).text), element.name.text)
      }
    }
    if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
      const members = namespaceMembers(file, bindings.name.text)
      if (members === undefined) throw new TestRejection(`uses the namespace import ${bindings.name.text} other than through its members`)
      const fields: string[] = []
      for (const member of [...members].sort()) {
        const local = `__ns${namespaces.length + 1}_${member}`
        add(target(fileName, specifier, member), local)
        fields.push(`${member}: ${local}`)
      }
      namespaces.push(`const ${bindings.name.text} = Object.freeze({ ${fields.join(', ')} });`)
    }
    for (const [path, names] of byPath) plan.lines.push(`import { ${names.join(', ')} } from ${JSON.stringify(`./${path}`)};`)
  }
  return { ...plan, framework, lines: [...builtins, ...plan.lines, ...namespaces] }
}

function assemble(collected: CollectedCase, js: string, file: ts.SourceFile, imports: readonly string[], framework: Framework): string {
  const lines = framework === 'expect' ? [SHIM_IMPORT, ...imports] : [...imports]
  for (const level of collected.levels) lines.push('{', ...level.prelude)
  const body = ts.isBlock(collected.body)
    ? js.slice(collected.body.getStart(file) + 1, collected.body.end - 1).trim()
    : `${js.slice(collected.body.getStart(file), collected.body.end).trim()};`
  lines.push('{', body, '}')
  for (const _level of collected.levels) lines.push('}')
  return `${lines.join('\n')}\n`
}

/**
 * The cases one test file's JavaScript build yields, or the reason it yields
 * none. A test is rejected whole for what its imports say: a package, a
 * runner binding outside the allowed set, a relative import that does not
 * resolve inside the source root, or two runners. A level whose own
 * statements register a hook or use a construct the shim cannot run drops the
 * blocks beneath it, a block does the same for its own body, and a block
 * registered through `it.each`, `it.skip`, a loop, or a non-literal title is
 * skipped; each is counted by reason, and the test is rejected only when no
 * block survives.
 * @param js - the test, transpiled.
 * @param fileName - the test's source path, from which its imports resolve.
 * @param context - the source tree.
 * @returns the plan, or the rejection.
 */
export function analyzeTest(js: string, fileName: string, context: TestContext): TestAnalysis {
  const file = parseSource(js, fileName)
  try {
    const imports = planImports(file, fileName, context)
    const framework: Framework = imports.framework ?? 'expect'
    const walker = new Walker(file, node => unsupportedConstruct(node, framework))
    walker.walk(file.statements.filter(statement => !ts.isImportDeclaration(statement)), [], [])
    const dropped: Record<string, number> = {}
    const cases: TestCase[] = []
    for (const collected of walker.cases) {
      const levelProblem = collected.levels.map(level => level.problem).find(problem => problem !== undefined)
      const problem = levelProblem ?? collected.extra
        ?? (collected.parameters > 0 ? 'block callback takes parameters' : undefined)
        ?? unsupportedConstruct(collected.body, framework)
      if (problem !== undefined) {
        tally(dropped, problem)
        continue
      }
      cases.push({ ordinal: collected.ordinal, title: collected.titles.join(' › '), program: assemble(collected, js, file, imports.lines, framework) })
    }
    if (imports.targets.size === 0) throw new TestRejection('imports nothing under test')
    if (cases.length === 0) {
      const reasons = Object.entries({ ...dropped, ...walker.skipped }).map(([reason, count]) => `${reason} (${count})`).join(', ')
      throw new TestRejection(reasons === '' ? 'has no block' : `keeps no block: ${reasons}`)
    }
    return {
      kind: 'cases',
      plan: {
        framework,
        cases,
        targets: [...imports.targets].sort(),
        entries: [...imports.entries].sort(),
        dropped,
        skipped: walker.skipped,
      },
    }
  } catch (error) {
    /* v8 ignore next -- anything but a rejection is a defect in the walk itself, which propagates; no test provokes one */
    if (!(error instanceof TestRejection)) throw error
    return { kind: 'rejected', reason: error.message }
  }
}

// --- Children --------------------------------------------------------------------------

/** Where a public child came from: the pinned source, its licence, and the module and tests it was derived from. */
interface PublicProvenance {
  readonly source: string
  readonly url: string
  readonly commit: string
  readonly license: string
  readonly licenseFile: string
  readonly licenseSha256: string
  /** The licence text's own copyright line, absent when it names none. */
  readonly copyright?: string
  /** The module's repository-relative path. */
  readonly module: string
  /** The repository-relative paths of the tests whose blocks became the child's cases. */
  readonly tests: readonly string[]
}

/** The fields a public child's `task.json` carries. */
export interface PublicTaskFile {
  readonly id: string
  readonly tier: number
  readonly domain: 'public'
  readonly public: PublicProvenance
  readonly terms: DataUseTerms
  readonly completion: { readonly file: string; readonly function: string }
  readonly title: string
  readonly prompt: string
  readonly heldOut: false
  readonly immutable: readonly string[]
  readonly checks: readonly RepositoryCheckFile[]
}

/** The case file every public child's cased check names, under the reference the workspace never receives. */
export const CASES_FILE = 'reference/cases.json'

/** The checks every public child carries: the held-back cases, and no installed dependencies. */
const PUBLIC_CHECKS: readonly RepositoryCheckFile[] = [
  {
    id: 'spec-cases',
    outcome: "the function satisfies the module's own test suite, which the validator holds back",
    run: 'node --input-type=module',
    cases: CASES_FILE,
  },
  { id: 'no-dependencies', outcome: 'no packages were installed', run: 'test ! -e node_modules' },
]

/** What one public child is made from. */
export interface PublicChildInput {
  readonly provenance: PublicProvenance
  readonly terms: DataUseTerms
  readonly functionName: string
  /** The stubbed module's workspace path. */
  readonly file: string
  readonly jsDoc: string
  readonly signature: string
  /** The other workspace files under `src/`, for the prompt's account of the workspace. */
  readonly companions: readonly string[]
  /** Whether the workspace carries the shim, which an `expect` suite's cases import. */
  readonly shim: boolean
  readonly caseCount: number
  readonly bands: TierBands
}

/** The prompt a public child hands an implementer: the file, the function, its provenance, its documentation, and the rules. */
function childPrompt(input: PublicChildInput): string {
  const { provenance } = input
  const companions = input.companions.length === 0
    ? ''
    : ` The other files under \`src/\` (${input.companions.map(one => `\`${one}\``).join(', ')}) are the module's own dependencies, unchanged; read them as you need, edit none.`
  const shim = input.shim ? ' `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed.' : ''
  return `\`${input.file}\` is the JavaScript build of \`${provenance.module}\` from ${provenance.source} (${provenance.url} at commit `
    + `${provenance.commit.slice(0, 12)}, ${provenance.license} licence, whose text is in \`${LICENSE_FILE}\`). Every export of the module is in `
    + `place except \`${input.functionName}\`, whose body currently throws 'not implemented'. Implement only that function's body so that it `
    + `fulfills its own documentation, which the source carries as follows:\n\n${input.jsDoc}\n${input.signature}\n\n`
    + 'Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the '
    + `signature and the documentation name.${companions} Add no dependencies: \`package.json\` is fixed and \`node_modules\` must not `
    + 'exist. This task is judged on inputs you do not see: a validator runs the module\'s own test suite, which this workspace does '
    + `not contain, against your implementation.${shim} Implement the documented contract, including every corner it states, rather `
    + 'than the behaviour a guessed test would pin down.'
}

/**
 * One public child's `task.json`.
 * @param input - the child's provenance, terms, function, documentation, and case count.
 * @returns the task file.
 */
export function publicTaskJson(input: PublicChildInput): PublicTaskFile {
  return {
    id: taskId(childId(input.provenance.source, input.functionName)),
    tier: tierFor(input.caseCount, input.bands),
    domain: 'public',
    public: input.provenance,
    terms: input.terms,
    completion: { file: input.file, function: input.functionName },
    title: `Implement ${input.functionName} from ${input.provenance.source}`,
    prompt: childPrompt(input),
    heldOut: false,
    immutable: ['README.md', 'package.json', LICENSE_FILE, ...input.shim ? [SHIM_FILE] : []],
    checks: PUBLIC_CHECKS,
  }
}

/**
 * The child's `README.md`: the task as the prompt states it, the attribution
 * the licence requires, then the type declarations the JavaScript build erased.
 * @param task - the child's task file.
 * @param types - the module's top-level type declarations, empty for a JavaScript source.
 * @returns the README text.
 */
export function publicReadme(task: PublicTaskFile, types: readonly ModuleType[]): string {
  const { public: provenance } = task
  const sections = [
    `# ${task.title}`,
    task.prompt,
    '## Attribution',
    `This task is derived from \`${provenance.module}\` of ${provenance.source} (${provenance.url}) at commit \`${provenance.commit}\`, `
    + `distributed under the ${provenance.license} licence${provenance.copyright === undefined ? '' : ` (${provenance.copyright})`}; `
    + `the licence text is kept in \`${LICENSE_FILE}\` and accompanies every copy of this task and anything derived from it.`,
  ]
  if (types.length > 0) {
    sections.push(
      '## Types the module declares',
      `The module's TypeScript source declares these types; the JavaScript build in \`${task.completion.file}\` erased them.`,
      `\`\`\`ts\n${types.map(type => type.text).join('\n\n')}\n\`\`\``,
    )
  }
  return `${sections.join('\n\n')}\n`
}

// --- Census -----------------------------------------------------------------------------

/** What the factory did with one source, as `CENSUS.json` records it. */
export interface SourceCensus {
  readonly name: string
  readonly url: string
  readonly commit: string
  readonly license: string
  /** `read` when the factory derived from the source, `dropped` when it could not be fetched or its licence failed the checks. */
  readonly status: 'read' | 'dropped'
  readonly reason?: string
  readonly modules: number
  readonly tests: number
  /** Tests that yielded at least one block. */
  readonly testsUsable: number
  readonly testsRejected: Readonly<Record<string, number>>
  readonly blocksDropped: Readonly<Record<string, number>>
  readonly blocksSkipped: Readonly<Record<string, number>>
  readonly candidates: number
  readonly written: number
  readonly admitted: number
}

/** The census one factory run prints and writes to `CENSUS.json`. */
export interface PublicCensus {
  readonly sources: readonly SourceCensus[]
  readonly modules: number
  readonly tests: number
  readonly candidates: number
  /** Candidate functions set aside, by reason. */
  readonly skips: Readonly<Record<string, number>>
  /** Cases the reference failed and the factory therefore dropped, by module. */
  readonly casesDroppedByReference: number
  readonly written: number
  readonly writtenByTier: Readonly<Record<string, number>>
  readonly admitted: number
  readonly admittedByTier: Readonly<Record<string, number>>
  readonly refused: number
  readonly refusedByReason: Readonly<Record<string, number>>
}

/** A test rejection's category, so the census groups the many tests one rule set aside. */
export function rejectionCategory(reason: string): string {
  if (/^imports the package /u.test(reason)) return 'imports a package'
  if (/^imports \S+ from (?:vitest|@jest\/globals|node:test)$/u.test(reason)) return 'imports a runner binding outside the allowed set'
  if (/^renames /u.test(reason)) return 'renames a runner binding'
  if (/which does not resolve|outside the source root|which no module declares|for its side effects/u.test(reason)) return 'imports outside the source root'
  if (/^imports the test file/u.test(reason)) return 'imports another test'
  if (/^keeps no block/u.test(reason)) return 'keeps no block'
  if (reason === 'has no block') return 'has no block'
  if (reason === 'imports nothing under test') return 'imports nothing under test'
  return reason
}
