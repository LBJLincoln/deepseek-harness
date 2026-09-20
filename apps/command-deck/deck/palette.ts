/**
 * The deck's colour vocabulary.
 *
 * Division hues are spaced around a deep, luminous ramp so ten clusters stay
 * distinguishable against the near-black background under bloom; severity
 * colours are the only place the deck uses red, so a critical finding reads as
 * the one urgent thing on screen.
 */

import type { EdgeKind, Severity } from './contract.ts'

/** Hex colour per division id, in roster order. */
const DIVISION_COLOR: Record<string, string> = {
  'harness-core': '#4fd8ff',
  'proving-ground': '#2fd4c8',
  verification: '#86e565',
  judging: '#e0d55e',
  curation: '#ffb04c',
  program: '#ff7a5c',
  'code-safety': '#ff5f86',
  knowledge: '#c87dff',
  governance: '#8f8cff',
  observatory: '#5f9bff',
}

/** Fallback for a division the roster names but the palette does not. */
const DIVISION_FALLBACK = '#9fb0cc'

/**
 * Hex colour per code-safety department id, in the order the program starts
 * them: the code-safety division's colour rotated across the 84° hue band that
 * lanes sharing one division spread over, so a department is one colour on the
 * process lanes and on the code city.
 */
const DEPARTMENT_COLOR: Record<string, string> = {
  secrets: '#ff5ff6',
  injection: '#ff5fc9',
  access: '#ff5f9c',
  data: '#ff5f70',
  dependencies: '#ff7b5f',
  platform: '#ffa85f',
}

/** Hex colour per severity, worst first. */
export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: '#ff3f6b',
  high: '#ff8a3d',
  medium: '#ffc94d',
  low: '#4fd8ff',
  info: '#7f8fb0',
}

/** Hex colour per roster edge kind. */
export const EDGE_COLOR: Record<EdgeKind, string> = {
  delegates: '#5b7bd6',
  verifies: '#49c98a',
  judges: '#d2c264',
  merges: '#ff9a6b',
  reads: '#4b5f8c',
  reports: '#7a6bd6',
}

/** Hex colour per detected language in the code city. */
const LANGUAGE_COLOR: Record<string, string> = {
  JavaScript: '#ffd45c',
  TypeScript: '#5aa9ff',
  JSON: '#8fe0b8',
  Markdown: '#8f9ec2',
  HTML: '#ff8a6b',
  CSS: '#c87dff',
  Docker: '#5fc8ff',
}

/** Fallback for a language the palette does not name. */
const LANGUAGE_FALLBACK = '#6d7fa6'

/**
 * Colour for one division id.
 * @param id - Division id from the roster.
 * @returns The division's hex colour, or the neutral fallback.
 */
export function divisionColor(id: string): string {
  return DIVISION_COLOR[id] ?? DIVISION_FALLBACK
}

/**
 * Colour for one code-safety department.
 * @param id - Department id, such as `access`.
 * @returns The department's hex colour, or `undefined` for an id that is not one of the six.
 */
export function departmentColor(id: string): string | undefined {
  return DEPARTMENT_COLOR[id]
}

/**
 * Colour for one source-file language.
 * @param language - Language name as the feed reports it.
 * @returns The language's hex colour, or the neutral fallback.
 */
export function languageColor(language: string): string {
  return LANGUAGE_COLOR[language] ?? LANGUAGE_FALLBACK
}
