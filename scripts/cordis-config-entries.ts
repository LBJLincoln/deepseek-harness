/**
 * Cordis Loader configuration parsing shared by the configuration gates.
 *
 * The Loader accepts a `!!js` scalar wherever it interpolates an expression. A
 * gate must read the authored text rather than its value, so the tag parses
 * into an inert node here and is never evaluated.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'

const jsExprType = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: data => typeof data === 'string',
  construct: (data: unknown): { __jsExpr: string } => {
    if (typeof data !== 'string') throw new TypeError('!!js requires a scalar string')
    return { __jsExpr: data }
  },
})
const schema = yaml.JSON_SCHEMA.extend(jsExprType)

/**
 * Parse one Loader configuration document.
 * @param source - YAML document text.
 * @returns the parsed document; callers decide whether it is an entry array.
 * @throws {yaml.YAMLException} when the document does not parse.
 */
export function parseCordisDocument(source: string): unknown {
  return yaml.load(source, { schema })
}

/**
 * Read and parse one Loader configuration file.
 * @param root - repository root the path is relative to.
 * @param file - repository-relative configuration path.
 * @returns the parsed document; callers decide whether it is an entry array.
 */
export function loadCordisDocument(root: string, file: string): unknown {
  return parseCordisDocument(readFileSync(resolve(root, file), 'utf8'))
}

/**
 * Whether a parsed node is an unevaluated `!!js` expression.
 * @param value - any parsed node.
 * @returns true when the node carries the expression text.
 */
export function isJsExpr(value: unknown): value is { __jsExpr: string } {
  return isRecord(value) && typeof value.__jsExpr === 'string'
}

/**
 * Whether a parsed node is a mapping (or any other non-null object).
 * @param value - any parsed node.
 * @returns true when the node has properties to walk.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

/**
 * Whether a parsed node is a sequence.
 * @param value - any parsed node.
 * @returns true when the node is an array.
 */
export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}
