/**
 * The pure half of the repository-derived environment factory
 * (`synthesize-repository-tasks.ts`): every decision that needs no file
 * system or subprocess, so a unit test can pin each one. It reads a module
 * and its spec through the TypeScript parser, which the factory already
 * depends on for transpiling, so the analysis is exact rather than a text
 * scan: which exported functions carry JSDoc and a signature to hand to an
 * implementer, which type declarations the module's own documentation names,
 * how one function's body is replaced by a stub in the transpiled JavaScript,
 * whether a spec stays inside the runtime imports and the matcher subset the
 * inlined `expect` shim implements, and how each of its `it` blocks becomes
 * one self-contained ESM program that `node --input-type=module` runs from
 * standard input against the workspace's `src/index.js`.
 *
 * A case program is the shim, the spec's imports with the module import
 * redirected to the workspace, the spec's module-level statements, and then
 * one block per enclosing `describe` holding that level's other statements,
 * innermost of which holds the `it` body. Every statement of a level runs
 * before the body, which is the order vitest runs them in (collection before
 * execution), and each level is a block so a name declared at one level
 * shadows an outer one exactly as the callback scopes did.
 */

import { resolve } from 'node:path'
import ts from 'typescript'

/** The vitest matchers a hidden case may use; `expect-shim.mjs` implements exactly these. */
export const MATCHER_SUBSET: ReadonlySet<string> = new Set([
  'toBe',
  'toEqual',
  'toStrictEqual',
  'toBeUndefined',
  'toBeNull',
  'toBeTruthy',
  'toBeFalsy',
  'toHaveLength',
  'toContain',
  'toThrow',
  'toMatch',
  'toBeGreaterThan',
  'toBeLessThan',
])

/** The vitest bindings a spec may import: the structure calls and the assertion entry point. */
const VITEST_BINDINGS: ReadonlySet<string> = new Set(['describe', 'it', 'test', 'expect'])

/** The body every stubbed function receives, in the transpiled file's own four-space style. */
export const STUB_BODY = "{\n    throw new Error('not implemented');\n}"

/**
 * The id marker of a repository child: `code:<package>--implement-<function>`
 * in `<package>--<function>/`. `admit.mjs` strips it before comparing an id to
 * its directory and `register-repository-environments.ts` restates it.
 */
const ID_MARKER = '--implement-'

const SUITE_CALLEES: ReadonlySet<string> = new Set(['describe', 'it', 'test'])

const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  newLine: ts.NewLineKind.LineFeed,
  removeComments: false,
}

/**
 * The plain ESM JavaScript of one TypeScript source, comments kept and
 * type-only imports elided, as `tsc` would emit it for one file.
 * @param source - the TypeScript text.
 * @param fileName - the source's name, for the diagnostic a syntax error carries.
 * @returns the JavaScript text.
 * @throws when the source does not parse.
 */
export function transpile(source: string, fileName: string): string {
  const result = ts.transpileModule(source, { fileName, reportDiagnostics: true, compilerOptions: COMPILER_OPTIONS })
  const problem = result.diagnostics?.[0]
  if (problem !== undefined) throw new Error(`${fileName}: ${ts.flattenDiagnosticMessageText(problem.messageText, '\n')}`)
  return result.outputText
}

function parse(text: string, fileName: string): ts.SourceFile {
  const kind = fileName.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true, kind)
}

function isExported(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
}

/**
 * Where a declaration's own JSDoc starts: the last `/**` comment directly
 * above it, with no blank line between. The parser attaches every leading
 * JSDoc block to the first statement, so a file's `@module` comment would
 * otherwise become the first declaration's documentation.
 * @returns the offset, or the declaration's own start when it has no JSDoc.
 */
function ownDocStart(source: string, file: ts.SourceFile, node: ts.Node): number {
  const start = node.getStart(file)
  let last: ts.TextRange | undefined
  ts.forEachLeadingCommentRange(source, node.pos, (pos, end) => {
    if (source.startsWith('/**', pos)) last = { pos, end }
  })
  if (last === undefined || /\n[ \t]*\n/u.test(source.slice(last.end, start))) return start
  return last.pos
}

/** A function-like initializer with a block body: the one form a stub can replace. */
function blockBodyOf(node: ts.Node): ts.Block | undefined {
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isBlock(node.body)) return node.body
  return undefined
}

/**
 * One exported function or block-bodied arrow of a module, located in whichever
 * text (TypeScript or its JavaScript build) the caller parsed.
 */
interface LocatedFunction {
  readonly name: string
  readonly node: ts.Node
  readonly body: ts.Block
}

function locateFunctions(file: ts.SourceFile): LocatedFunction[] {
  const found: LocatedFunction[] = []
  for (const statement of file.statements) {
    if (!isExported(statement)) continue
    if (ts.isFunctionDeclaration(statement)) {
      if (statement.name !== undefined && statement.body !== undefined) {
        found.push({ name: statement.name.text, node: statement, body: statement.body })
      }
      continue
    }
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue
      const body = blockBodyOf(declaration.initializer)
      if (body !== undefined) found.push({ name: declaration.name.text, node: statement, body })
    }
  }
  return found
}

/** One exported function of a module, as the factory hands it to an implementer. */
export interface ModuleFunction {
  readonly name: string
  /** The `/** … *​/` block immediately above the declaration, verbatim; empty when the function has none. */
  readonly jsDoc: string
  /** The declaration from its first token to its body, such as `export function f(a: A): B`. */
  readonly signature: string
  /** Lines the body spans, ignoring the blank margin inside its braces. */
  readonly bodyLines: number
}

/** One top-level `interface` or `type` declaration of a module, with its JSDoc, verbatim. */
export interface ModuleType {
  readonly name: string
  readonly text: string
}

/** What the factory reads from one module's TypeScript source. */
export interface ModuleAnalysis {
  readonly functions: readonly ModuleFunction[]
  readonly types: readonly ModuleType[]
}

/**
 * Every exported function with a block body and every top-level type
 * declaration of a module's TypeScript source, in source order.
 * @param source - the module's TypeScript text.
 * @param fileName - the module's name, for the parser.
 * @returns the functions and the types.
 */
export function analyzeModule(source: string, fileName: string): ModuleAnalysis {
  const file = parse(source, fileName)
  const functions = locateFunctions(file).map(({ name, node, body }) => {
    const inner = source.slice(body.getStart(file) + 1, body.end - 1).trim()
    return {
      name,
      jsDoc: source.slice(ownDocStart(source, file, node), node.getStart(file)).trim(),
      signature: source.slice(node.getStart(file), body.getStart(file)).trim(),
      bodyLines: inner === '' ? 0 : inner.split('\n').length,
    }
  })
  const types: ModuleType[] = []
  for (const statement of file.statements) {
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      types.push({ name: statement.name.text, text: source.slice(ownDocStart(source, file, statement), statement.end) })
    }
  }
  return { functions, types }
}

/**
 * The module's JavaScript with one exported function's body replaced by
 * {@link STUB_BODY}; every other byte is untouched.
 * @param js - the transpiled module.
 * @param name - the exported function to stub.
 * @param fileName - the module's name, for the error.
 * @returns the stubbed JavaScript.
 * @throws when `js` exports no block-bodied function of that name.
 */
export function stubFunction(js: string, name: string, fileName: string): string {
  const file = parse(js, fileName)
  const target = locateFunctions(file).find(one => one.name === name)
  if (target === undefined) throw new Error(`${fileName}: no exported function ${name} with a block body`)
  return `${js.slice(0, target.body.getStart(file))}${STUB_BODY}${js.slice(target.body.end)}`
}

/** What a spec's TypeScript imports say about where it can run. */
export interface SpecImports {
  /** Every runtime import specifier other than `vitest`, in source order. */
  readonly runtime: readonly string[]
  /** Why the spec cannot become cases on its imports alone, when it cannot. */
  readonly rejection?: string
}

function specifierOf(declaration: ts.ImportDeclaration): string {
  // The grammar allows only a string literal here; the node type is the wider Expression.
  return (declaration.moduleSpecifier as ts.StringLiteral).text
}

/**
 * The runtime imports of a spec's TypeScript source. A type-only import, or a
 * named import whose every element is type-only, is erased by transpiling and
 * is not a runtime import. The `vitest` import may bind only
 * {@link VITEST_BINDINGS}; a default, namespace, or side-effect import of
 * anything is a rejection.
 * @param source - the spec's TypeScript text.
 * @param fileName - the spec's name, for the parser.
 * @returns the runtime specifiers, or the first rejection.
 */
export function analyzeSpecImports(source: string, fileName: string): SpecImports {
  const file = parse(source, fileName)
  const runtime: string[] = []
  let rejection: string | undefined
  const reject = (reason: string): void => {
    rejection ??= reason
  }
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    const specifier = specifierOf(statement)
    const clause = statement.importClause
    if (clause === undefined) {
      reject(`imports ${specifier} for its side effects`)
      continue
    }
    if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) continue
    const bindings = clause.namedBindings
    if (clause.name !== undefined || bindings === undefined || ts.isNamespaceImport(bindings)) {
      if (specifier === 'vitest') reject('imports vitest as a default or namespace')
      else runtime.push(specifier)
      continue
    }
    const values = bindings.elements.filter(element => !element.isTypeOnly)
    if (values.length === 0) continue
    if (specifier !== 'vitest') {
      runtime.push(specifier)
      continue
    }
    const outside = values.find(element => !VITEST_BINDINGS.has((element.propertyName ?? element.name).text))
    if (outside !== undefined) reject(`imports ${(outside.propertyName ?? outside.name).text} from vitest`)
  }
  return { runtime, ...rejection === undefined ? {} : { rejection } }
}

/**
 * Why a spec's runtime imports are not exactly the module under test, or
 * `undefined` when they are: every runtime import must be one of the
 * module's own specifiers, and there must be at least one.
 * @param imports - the spec's analyzed imports.
 * @param moduleSpecifiers - the specifiers that name the module (its relative path and its package name).
 * @returns the rejection, or `undefined`.
 */
export function importsOnlyModule(imports: SpecImports, moduleSpecifiers: readonly string[]): string | undefined {
  if (imports.rejection !== undefined) return imports.rejection
  const foreign = imports.runtime.find(specifier => !moduleSpecifiers.includes(specifier))
  if (foreign !== undefined) return `imports ${foreign}`
  if (imports.runtime.length === 0) return 'imports nothing under test'
  return undefined
}

/** One hidden case: the program `node --input-type=module` reads from standard input. */
export interface SpecCase {
  /** 1-based position among the spec's `it` blocks, in source order. */
  readonly ordinal: number
  /** The `describe` titles and the `it` title, joined by ` › `. */
  readonly title: string
  readonly program: string
}

/** Either the cases a spec yields or why it yields none. */
export type SpecAnalysis =
  | { readonly kind: 'cases'; readonly cases: readonly SpecCase[] }
  | { readonly kind: 'rejected'; readonly reason: string }

/** What {@link analyzeSpec} needs beyond the spec itself. */
export interface SpecOptions {
  /** The specifiers that name the module under test in the spec's imports. */
  readonly moduleSpecifiers: readonly string[]
  /** The specifier a case program imports the module by, relative to the workspace. */
  readonly moduleImport: string
  /** The `expect` shim's text, inlined ahead of every case. */
  readonly shim: string
}

/** A rejection raised while walking a spec, carried to {@link analyzeSpec}'s result. */
class SpecRejection extends Error {}

function literalText(node: ts.Node): string | undefined {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined
}

/** One `describe` level or the spec's top level: its own statements and the suite calls beneath it. */
interface Level {
  readonly titles: readonly string[]
  readonly prelude: readonly string[]
}

/** The levels enclosing one case, the spec's top level first; a case always has at least that one. */
type Levels = readonly [...Level[], Level]

interface CollectedCase {
  readonly titles: readonly string[]
  readonly levels: Levels
  readonly body: string
}

/**
 * Splits one level's statements into the suite calls and the rest, then
 * descends into each `describe` and records each `it`; the callee identifiers
 * it recognizes are the only `describe`/`it`/`test` references a spec may hold.
 */
class SuiteWalker {
  readonly cases: CollectedCase[] = []
  readonly recognized = new Set<ts.Node>()
  private readonly file: ts.SourceFile
  private readonly js: string

  constructor(file: ts.SourceFile, js: string) {
    this.file = file
    this.js = js
  }

  walk(statements: readonly ts.Statement[], levels: readonly Level[], titles: readonly string[]): void {
    const suiteCalls: ts.CallExpression[] = []
    const prelude: string[] = []
    for (const statement of statements) {
      const call = ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) ? statement.expression : undefined
      if (call !== undefined && ts.isIdentifier(call.expression) && SUITE_CALLEES.has(call.expression.text)) {
        suiteCalls.push(call)
        continue
      }
      prelude.push(statement.getText(this.file))
    }
    const current: Levels = [...levels, { titles, prelude }]
    for (const call of suiteCalls) this.suite(call, current, titles)
  }

  private suite(call: ts.CallExpression, levels: Levels, titles: readonly string[]): void {
    const callee = call.expression as ts.Identifier
    const kind = callee.text
    this.recognized.add(callee)
    const [titleNode, callback, ...rest] = call.arguments
    const title = titleNode === undefined ? undefined : literalText(titleNode)
    if (title === undefined) throw new SpecRejection(`${kind} title is not a string literal`)
    if (callback === undefined) throw new SpecRejection(`${kind} has no callback`)
    if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) throw new SpecRejection(`${kind} callback is not a function`)
    if (callback.parameters.length > 0) throw new SpecRejection(`${kind} callback takes parameters`)
    if (!ts.isBlock(callback.body)) throw new SpecRejection(`${kind} callback has no block body`)
    const own = [...titles, title]
    if (kind === 'describe') {
      if (rest.length > 0) throw new SpecRejection('describe carries extra arguments')
      this.walk(callback.body.statements, levels, own)
      return
    }
    if (rest.length > 1 || (rest[0] !== undefined && !ts.isNumericLiteral(rest[0]))) throw new SpecRejection(`${kind} carries an unsupported third argument`)
    const body = this.js.slice(callback.body.getStart(this.file) + 1, callback.body.end - 1)
    this.cases.push({ titles: own, levels, body })
  }
}

/** The chain after `expect(...)`: `.not` at most once, then one subset matcher, called. */
function checkExpectChain(call: ts.CallExpression): void {
  let cursor: ts.Node = call
  let negated = false
  for (;;) {
    const access = cursor.parent
    if (!ts.isPropertyAccessExpression(access) || access.expression !== cursor) throw new SpecRejection('calls expect without a matcher')
    const name = access.name.text
    if (name === 'not') {
      if (negated) throw new SpecRejection('chains .not twice')
      negated = true
      cursor = access
      continue
    }
    if (name === 'resolves' || name === 'rejects') throw new SpecRejection(`uses expect(...).${name}`)
    if (!MATCHER_SUBSET.has(name)) throw new SpecRejection(`matcher ${name} is outside the subset`)
    const matcherCall = access.parent
    if (!ts.isCallExpression(matcherCall) || matcherCall.expression !== access) throw new SpecRejection(`references matcher ${name} without calling it`)
    return
  }
}

/** Every `describe`/`it`/`test`/`expect`/`require`/`import()` use the suite walk did not account for. */
function checkReferences(file: ts.SourceFile, recognized: ReadonlySet<ts.Node>): void {
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) throw new SpecRejection('uses import()')
    if (ts.isIdentifier(node)) {
      const parent = node.parent
      // A property's own name (`result.expect`, `{ it: 1 }`) is not a reference to the binding.
      if ((ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent)) && parent.name === node) return
      const call = ts.isCallExpression(parent) && parent.expression === node ? parent : undefined
      const access = ts.isPropertyAccessExpression(parent) && parent.expression === node ? parent : undefined
      if (node.text === 'require' && call !== undefined) throw new SpecRejection('uses require')
      if (SUITE_CALLEES.has(node.text) && !recognized.has(node)) {
        if (access !== undefined) throw new SpecRejection(`uses ${node.text}.${access.name.text}`)
        if (call !== undefined) throw new SpecRejection(`calls ${node.text} outside a suite body`)
        throw new SpecRejection(`references ${node.text} outside a suite call`)
      }
      if (node.text === 'expect') {
        if (access !== undefined) throw new SpecRejection(`uses expect.${access.name.text}`)
        if (call === undefined) throw new SpecRejection('references expect without calling it')
        checkExpectChain(call)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
}

function importLines(file: ts.SourceFile, options: SpecOptions): string[] {
  const lines: string[] = []
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    const specifier = specifierOf(statement)
    if (specifier === 'vitest') continue
    const clause = statement.importClause
    if (clause === undefined || !options.moduleSpecifiers.includes(specifier)) throw new SpecRejection(`imports ${specifier}`)
    lines.push(`import ${clause.getText(file)} from ${JSON.stringify(options.moduleImport)};`)
  }
  return lines
}

function assemble(collected: CollectedCase, imports: readonly string[], options: SpecOptions): string {
  const [top, ...nested] = collected.levels
  const lines = [options.shim.trimEnd(), ...imports, ...top.prelude]
  for (const level of nested) lines.push('{', ...level.prelude)
  lines.push('{', collected.body.trim(), '}')
  for (const _level of nested) lines.push('}')
  return `${lines.join('\n')}\n`
}

/**
 * The cases one spec's JavaScript build yields, or the first reason it yields
 * none: an import outside the module and `vitest`, a `describe`/`it`/`test`
 * used other than as a titled zero-parameter block callback (modifiers such
 * as `it.each`, callbacks with parameters, loops registering cases), an
 * `expect` chain outside {@link MATCHER_SUBSET} (including `expect.any`,
 * `.resolves`, and `.rejects`), a dynamic import, or a spec with no `it`.
 * @param js - the spec, transpiled.
 * @param fileName - the spec's name, for the parser.
 * @param options - the module's specifiers, the workspace import, and the shim.
 * @returns the cases in source order, or the rejection.
 */
export function analyzeSpec(js: string, fileName: string, options: SpecOptions): SpecAnalysis {
  const file = parse(js, fileName)
  try {
    const imports = importLines(file, options)
    const walker = new SuiteWalker(file, js)
    walker.walk(file.statements.filter(statement => !ts.isImportDeclaration(statement)), [], [])
    checkReferences(file, walker.recognized)
    if (walker.cases.length === 0) throw new SpecRejection('has no it block')
    const cases = walker.cases.map((collected, index) => ({
      ordinal: index + 1,
      title: collected.titles.join(' › '),
      program: assemble(collected, imports, options),
    }))
    return { kind: 'cases', cases }
  } catch (error) {
    /* v8 ignore next -- anything but a rejection is a defect in the walk itself, which propagates; no spec provokes one */
    if (!(error instanceof SpecRejection)) throw error
    return { kind: 'rejected', reason: error.message }
  }
}

/** The case counts at which a child's tier rises from 2 to 3 and from 3 to 4. */
export interface TierBands {
  readonly tier3From: number
  readonly tier4From: number
}

/**
 * Parses a `--tier-bands` value such as `4,12`.
 * @param text - two positive integers, ascending, separated by a comma.
 * @returns the bands.
 * @throws on any other text.
 */
export function parseTierBands(text: string): TierBands {
  const parts = text.split(',').map(Number)
  const [tier3From, tier4From] = parts
  const wellFormed = parts.length === 2 && tier3From !== undefined && tier4From !== undefined
    && Number.isInteger(tier3From) && Number.isInteger(tier4From) && tier3From >= 1 && tier4From > tier3From
  if (!wellFormed) {
    throw new Error(`synthesize-repository-tasks: --tier-bands needs two ascending positive integers, got "${text}"`)
  }
  return { tier3From, tier4From }
}

/**
 * The tier a child earns from the number of hidden cases that exercise its
 * function: 2 below `tier3From`, 3 below `tier4From`, 4 from there on.
 * @param cases - the exercising case count.
 * @param bands - the thresholds.
 * @returns the tier.
 */
export function tierFor(cases: number, bands: TierBands): 2 | 3 | 4 {
  if (cases >= bands.tier4From) return 4
  if (cases >= bands.tier3From) return 3
  return 2
}

/** Where a child came from, as repository-relative POSIX paths and the package's npm name. */
export interface RepositorySource {
  readonly package: string
  readonly module: string
  readonly spec: string
}

/** One check as a repository child's `task.json` declares it. */
export interface RepositoryCheckFile {
  readonly id: string
  readonly outcome: string
  readonly run: string
  readonly cases?: string
}

/** The fields a repository child's `task.json` carries, in the completion family's key order plus `repository`. */
export interface RepositoryTaskFile {
  readonly id: string
  readonly tier: number
  readonly domain: 'repository'
  readonly repository: RepositorySource
  readonly completion: { readonly file: string; readonly function: string }
  readonly title: string
  readonly prompt: string
  readonly heldOut: boolean
  readonly immutable: readonly string[]
  readonly checks: readonly RepositoryCheckFile[]
}

/** The workspace path every repository child's stubbed module lives at. */
export const MODULE_FILE = 'src/index.js'

/** The case file every repository child's cased check names, under the reference the workspace never receives. */
export const CASES_FILE = 'reference/cases.json'

/** The checks every repository child carries: the held-back cases, and no installed dependencies. */
export const REPOSITORY_CHECKS: readonly RepositoryCheckFile[] = [
  {
    id: 'spec-cases',
    outcome: "the function satisfies the module's own test suite, which the validator holds back",
    run: 'node --input-type=module',
    cases: CASES_FILE,
  },
  { id: 'no-dependencies', outcome: 'no packages were installed', run: 'test ! -e node_modules' },
]

/** What one child is made from. */
export interface ChildInput {
  /** The package directory's name, which the child directory is named after. */
  readonly packageDir: string
  readonly functionName: string
  readonly source: RepositorySource
  readonly jsDoc: string
  readonly signature: string
  /** How many hidden cases exercise the function. */
  readonly caseCount: number
  readonly bands: TierBands
}

/**
 * The child directory's name.
 * @param packageDir - the package directory's name.
 * @param functionName - the stubbed function.
 * @returns `<package>--<function>`.
 */
export function childId(packageDir: string, functionName: string): string {
  return `${packageDir}--${functionName}`
}

/**
 * The environment id a child directory registers under: the marker
 * {@link ID_MARKER} in place of the directory's `--`, as `admit.mjs` and the
 * registrar both expect.
 * @param directory - the child directory's name.
 * @returns the id.
 */
export function taskId(directory: string): string {
  return `code:${directory.replace('--', ID_MARKER)}`
}

/** The prompt a repository child hands an implementer: the file, the function, its documentation, and the rules. */
function childPrompt(input: ChildInput): string {
  return `\`${MODULE_FILE}\` is the JavaScript build of \`${input.source.module}\`, the module of the DeepSeek Harness repository `
    + `published as \`${input.source.package}\`. Every export of the module is in place except \`${input.functionName}\`, whose `
    + 'body currently throws \'not implemented\'. Implement only that function\'s body so that it fulfills its own documentation, '
    + `which the source carries as follows:\n\n${input.jsDoc}\n${input.signature}\n\n`
    + 'Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the '
    + 'signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This '
    + 'task is judged on inputs you do not see: a validator runs the module\'s own test suite, which this workspace does not '
    + 'contain, against your implementation, so implement the documented contract, including every corner it states, rather than '
    + 'the behaviour a guessed test would pin down.'
}

/**
 * One repository child's `task.json`.
 * @param input - the child's source, function, documentation, and case count.
 * @returns the task file.
 */
export function childTaskJson(input: ChildInput): RepositoryTaskFile {
  return {
    id: taskId(childId(input.packageDir, input.functionName)),
    tier: tierFor(input.caseCount, input.bands),
    domain: 'repository',
    repository: input.source,
    completion: { file: MODULE_FILE, function: input.functionName },
    title: `Implement ${input.functionName} in ${input.source.package}`,
    prompt: childPrompt(input),
    heldOut: false,
    immutable: ['README.md', 'package.json'],
    checks: REPOSITORY_CHECKS,
  }
}

/**
 * The child's `README.md`: the task as the prompt states it, then the type
 * declarations the JavaScript build erased, so the signature and the
 * documentation the prompt hands over resolve every name they use.
 * @param task - the child's task file.
 * @param types - the module's top-level type declarations.
 * @returns the README text.
 */
export function childReadme(task: RepositoryTaskFile, types: readonly ModuleType[]): string {
  const sections = [`# ${task.title}`, task.prompt]
  if (types.length > 0) {
    sections.push(
      '## Types the module declares',
      `The module's TypeScript source declares these types; the JavaScript build in \`${MODULE_FILE}\` erased them.`,
      `\`\`\`ts\n${types.map(type => type.text).join('\n\n')}\n\`\`\``,
    )
  }
  return `${sections.join('\n\n')}\n`
}

/** One hidden case as `reference/cases.json` holds it: the program on standard input, judged on its exit code alone. */
export interface CaseEntry {
  readonly id: string
  readonly title: string
  readonly weight: number
  readonly argv: readonly string[]
  readonly stdin: string
  readonly exitCode: number
  readonly stdout: string
  readonly channels: readonly ['exit']
}

/**
 * The case file entries for the cases that exercise one function. Only the
 * exit code is compared: a passing program prints nothing, and what an
 * implementation happens to log must not fail a case whose assertions held.
 * @param cases - the exercising cases, in source order.
 * @returns the entries, one per case.
 */
export function caseEntries(cases: readonly SpecCase[]): CaseEntry[] {
  return cases.map(one => ({
    id: `case-${String(one.ordinal).padStart(3, '0')}`,
    title: one.title,
    weight: 1,
    argv: [],
    stdin: one.program,
    exitCode: 0,
    stdout: '',
    channels: ['exit'],
  }))
}

/** The factory's options, every one settable from the command line. */
export interface FactoryOptions {
  /** The directory whose `<package>/src/*.ts` modules and `<package>/tests/*.spec.ts` specs are read. */
  readonly packagesDir: string
  /** Where the children are written; removed and rewritten whole on every real run. */
  readonly outDir: string
  /** The repository root the `repository` field's paths are relative to. */
  readonly repoRoot: string
  /** A function whose body has fewer lines is skipped. */
  readonly minLines: number
  readonly bands: TierBands
  /** How long one case program may run, in the factory's own reference and stub runs. */
  readonly caseTimeoutMs: number
  readonly dryRun: boolean
  readonly admit: boolean
}

function requireValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index]
  if (value === undefined) throw new Error(`synthesize-repository-tasks: ${flag} needs a value`)
  return value
}

function requireInt(argv: readonly string[], index: number, flag: string): number {
  const value = Number(requireValue(argv, index, flag))
  if (!Number.isInteger(value) || value < 0) throw new Error(`synthesize-repository-tasks: ${flag} needs a non-negative integer`)
  return value
}

/**
 * The command line, parsed over the defaults the factory's header documents.
 * @param argv - `process.argv.slice(2)`.
 * @param defaults - the options every flag overrides.
 * @returns the options.
 * @throws on an unknown flag, a missing or malformed value, or `--dry-run` with `--admit`.
 */
export function parseArgs(argv: readonly string[], defaults: FactoryOptions): FactoryOptions {
  let options = defaults
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string
    switch (arg) {
      case '--dry-run':
        options = { ...options, dryRun: true }
        break
      case '--admit':
        options = { ...options, admit: true }
        break
      case '--packages-dir':
        options = { ...options, packagesDir: resolve(requireValue(argv, ++index, arg)) }
        break
      case '--out-dir':
        options = { ...options, outDir: resolve(requireValue(argv, ++index, arg)) }
        break
      case '--min-lines':
        options = { ...options, minLines: requireInt(argv, ++index, arg) }
        break
      case '--tier-bands':
        options = { ...options, bands: parseTierBands(requireValue(argv, ++index, arg)) }
        break
      case '--case-timeout-ms':
        options = { ...options, caseTimeoutMs: requireInt(argv, ++index, arg) }
        break
      default:
        throw new Error(`synthesize-repository-tasks: unrecognised argument "${arg}"`)
    }
  }
  if (options.dryRun && options.admit) throw new Error('synthesize-repository-tasks: --dry-run and --admit are mutually exclusive')
  return options
}
