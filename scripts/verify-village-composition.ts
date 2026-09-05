/**
 * Village composition rules for Daliesk Village district configurations.
 *
 * A configuration composing the environment runner, the fleet, or the
 * experiment driver runs sessions nobody watches: they spend tokens, and the
 * durable log — not the workspace — is the record. Such a file must therefore
 * also compose the session budget policy with at least one enforced cap, a
 * session persistence backend, and the checkpoint policy. A fleet entry must
 * set `workspaceRetention`, which the fleet schema requires: the gate names it
 * as a village rule so the diagnostic states why an unattended shift cannot
 * leave the decision to a default.
 *
 * A runner declaring `isolation: process` or `host` reports a warning. That
 * claim reaches the certificate, and the read-barrier slices that would make it
 * true (shell, subprocess, and terminal denial) are not on this branch, so the
 * claim is unproven rather than wrong. `--strict` fails on those warnings as
 * well, for a deployment that requires every isolation claim to be provable.
 *
 * Scope is the Loader configuration inventory `verify-cordis-config` scans. An
 * entry disabled by a literal value is not composed; an entry gated by a `!!js`
 * `disabled` expression may or may not mount, so it triggers the rules as a
 * district and never satisfies one as a requirement.
 *
 * @see ../.agents/notes/proposed/architecture/2026-09-05-daliesk-village.md
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cordisConfigFiles } from './cordis-config-files.ts'
import { isJsExpr, isRecord, isUnknownArray, parseCordisDocument } from './cordis-config-entries.ts'

const root = resolve(import.meta.dirname, '..')

const RUNNER_PACKAGE = '@deepseek-ai/dsh-environment-runner'
const FLEET_PACKAGE = '@deepseek-ai/dsh-fleet'
const BUDGET_POLICY_PACKAGE = '@deepseek-ai/dsh-budget-policy'

/** Composing any of these puts a configuration under the village rules. */
const DISTRICT_PACKAGES: readonly string[] = [
  RUNNER_PACKAGE,
  FLEET_PACKAGE,
  '@deepseek-ai/dsh-experiments',
]

/** The `Config` keys of `@deepseek-ai/dsh-budget-policy` that set an enforced cap. */
const BUDGET_CAP_FIELDS: readonly string[] = [
  'maxTotalTokens',
  'maxInputTokens',
  'maxOutputTokens',
  'maxWallMs',
  'maxCostEur',
]

/** The session persistence backends, either of which satisfies the persistence rule. */
const PERSISTENCE_PACKAGES: readonly string[] = [
  '@deepseek-ai/dsh-session-persistence-jsonl',
  '@deepseek-ai/dsh-session-persistence-sqlite',
]

/** Runner isolation claims no read-barrier slice on this branch can prove. */
const UNPROVEN_ISOLATIONS: readonly string[] = ['process', 'host']

/** One village rule, named in every diagnostic it produces. */
export type VillageRuleId =
  | 'budget-policy'
  | 'session-persistence'
  | 'session-checkpoint-policy'
  | 'fleet-workspace-retention'
  | 'runner-isolation'

/** One rule violation, attributed to the entry that carries it. */
export interface VillageDiagnostic {
  /** Repository-relative configuration path. */
  readonly file: string
  /** The `id` of the entry the rule is attributed to, or its package name when it declares none. */
  readonly entryId: string
  /** The rule that was violated. */
  readonly rule: VillageRuleId
  /** `warning` for an unproven claim the branch cannot yet check; `error` otherwise. */
  readonly severity: 'error' | 'warning'
  /** Why the rule failed, without the file, entry, or rule name. */
  readonly detail: string
}

/** How the Loader decides whether one entry mounts. */
type MountState = 'always' | 'conditional' | 'never'

/** One composed Loader row: what it mounts, how it is gated, and its plugin config. */
interface ComposedRow {
  readonly id: string
  readonly name: string
  readonly mount: Exclude<MountState, 'never'>
  readonly config: Record<string, unknown> | undefined
}

/** A package the district rules require, plus any condition on the row that provides it. */
interface Requirement {
  readonly rule: VillageRuleId
  readonly packages: readonly string[]
  readonly satisfies?: (row: ComposedRow) => string | undefined
}

const REQUIREMENTS: readonly Requirement[] = [
  {
    rule: 'budget-policy',
    packages: [BUDGET_POLICY_PACKAGE],
    satisfies: row => BUDGET_CAP_FIELDS.some(field => isCap(row.config?.[field]))
      ? undefined
      : `entry "${row.id}" sets none of ${BUDGET_CAP_FIELDS.join(', ')}, so it enforces no cap`,
  },
  { rule: 'session-persistence', packages: PERSISTENCE_PACKAGES },
  { rule: 'session-checkpoint-policy', packages: ['@deepseek-ai/dsh-session-checkpoint-policy'] },
]

if (import.meta.main) {
  let strict: boolean
  try {
    strict = parseStrictFlag(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(2)
  }
  const files = cordisConfigFiles(root)
  const diagnostics = files.flatMap(file => villageCompositionDiagnostics(file, readFileSync(resolve(root, file), 'utf8')))
  const warnings = diagnostics.filter(diagnostic => diagnostic.severity === 'warning')
  const errors = strict ? diagnostics : diagnostics.filter(diagnostic => diagnostic.severity === 'error')

  if (!strict) {
    for (const warning of warnings) console.warn(`verify-village-composition: warning: ${formatVillageDiagnostic(warning)}`)
  }
  if (errors.length > 0) {
    console.error('verify-village-composition: district compositions violate the village rules:')
    for (const error of errors) console.error(`- ${formatVillageDiagnostic(error)}`)
    process.exitCode = 1
  } else {
    console.log(`verify-village-composition: ${files.length} config files passed with ${warnings.length} warning(s).`)
  }
}

/**
 * Read the one supported flag before any file is scanned.
 * @param args - process arguments after the script path.
 * @returns whether warnings must fail the gate.
 * @throws {Error} on any other argument, so a misspelled flag never passes silently.
 */
export function parseStrictFlag(args: readonly string[]): boolean {
  const unknown = args.filter(arg => arg !== '--strict')
  if (unknown.length > 0) {
    throw new Error(`verify-village-composition: unsupported argument(s) ${unknown.join(', ')}; the only flag is --strict.`)
  }
  return args.includes('--strict')
}

/**
 * Render one diagnostic as the line the gate prints.
 * @param diagnostic - the violation to render.
 * @returns the file, the entry id, the rule, and the failure detail.
 */
export function formatVillageDiagnostic(diagnostic: VillageDiagnostic): string {
  return `${diagnostic.file} [entry "${diagnostic.entryId}"]: village rule ${diagnostic.rule}: ${diagnostic.detail}`
}

/**
 * Apply the village rules to one Loader configuration.
 * @param file - repository-relative path used in diagnostics.
 * @param source - the configuration's YAML text.
 * @returns every violation in the file; empty when the document composes no district plugin.
 */
export function villageCompositionDiagnostics(file: string, source: string): VillageDiagnostic[] {
  const document: unknown = parseCordisDocument(source)
  // A non-array root is `verify-cordis-config`'s diagnostic, not this gate's.
  if (!isUnknownArray(document)) return []
  const rows: ComposedRow[] = []
  collectRows(document, false, rows)

  const district = rows.find(row => DISTRICT_PACKAGES.includes(row.name))
  if (district === undefined) return []

  const diagnostics: VillageDiagnostic[] = []
  for (const requirement of REQUIREMENTS) {
    const detail = requirementFailure(rows, requirement)
    if (detail === undefined) continue
    diagnostics.push({
      file,
      entryId: district.id,
      rule: requirement.rule,
      severity: 'error',
      detail: `composing ${district.name} requires ${requirement.packages.join(' or ')}; ${detail}`,
    })
  }

  for (const row of rows.filter(candidate => candidate.name === FLEET_PACKAGE)) {
    if (row.config !== undefined && 'workspaceRetention' in row.config) continue
    diagnostics.push({
      file,
      entryId: row.id,
      rule: 'fleet-workspace-retention',
      severity: 'error',
      detail: `${FLEET_PACKAGE} requires workspaceRetention; an unattended shift cannot leave unreaped cell workspaces to a default`,
    })
  }

  for (const row of rows.filter(candidate => candidate.name === RUNNER_PACKAGE)) {
    const isolation = row.config?.isolation
    if (typeof isolation !== 'string' || !UNPROVEN_ISOLATIONS.includes(isolation)) continue
    diagnostics.push({
      file,
      entryId: row.id,
      rule: 'runner-isolation',
      severity: 'warning',
      detail: `isolation: ${isolation} reaches the certificate, and the read-barrier slices that deny shell, subprocess, and terminal reads are not on this branch, so the claim is unproven`,
    })
  }

  return diagnostics
}

/**
 * Why one requirement is unmet.
 * @param rows - every composed row of the file.
 * @param requirement - the package the district rules require.
 * @returns the failure clause, or `undefined` when the requirement holds.
 */
function requirementFailure(rows: readonly ComposedRow[], requirement: Requirement): string | undefined {
  const candidates = rows.filter(row => requirement.packages.includes(row.name))
  if (candidates.length === 0) return 'this file composes none of them'
  const mounted = candidates.filter(row => row.mount === 'always')
  const gated = candidates.find(row => row.mount === 'conditional')
  // Every candidate is one of the two states, so an empty mounted list has a gated row.
  if (mounted.length === 0 && gated !== undefined) {
    return `entry "${gated.id}" is gated by a disabled expression, so the mount is not guaranteed`
  }
  const satisfies = requirement.satisfies
  if (satisfies === undefined) return undefined
  const failures = mounted.map(row => satisfies(row))
  return failures.every(failure => failure !== undefined) ? failures[0] : undefined
}

/**
 * Collect every row a Loader configuration can mount, following group `config`
 * lists, `insert` lists, and include patches the way `verify-cordis-config`
 * walks them.
 * @param entries - the entry (or patch) list to walk.
 * @param gated - whether an ancestor row is itself gated by an expression.
 * @param rows - accumulator appended in place.
 */
function collectRows(entries: readonly unknown[], gated: boolean, rows: ComposedRow[]): void {
  for (const entry of entries) {
    if (!isRecord(entry)) continue
    const state = mountState(entry)
    if (state === 'never') continue
    const conditional = gated || state === 'conditional'
    if (typeof entry.name === 'string') {
      rows.push({
        id: typeof entry.id === 'string' ? entry.id : entry.name,
        name: entry.name,
        mount: conditional ? 'conditional' : 'always',
        config: isRecord(entry.config) && !isUnknownArray(entry.config) ? entry.config : undefined,
      })
    }
    if ((entry.group === true || entry.name === '@deepseek-ai/cordis-plugin-group') && isUnknownArray(entry.config)) {
      collectRows(entry.config, conditional, rows)
    }
    if (isUnknownArray(entry.insert)) collectRows(entry.insert, conditional, rows)
    if (entry.name !== '@deepseek-ai/cordis-plugin-include') continue
    if (isRecord(entry.config) && isUnknownArray(entry.config.patches)) {
      collectRows(entry.config.patches, conditional, rows)
    }
  }
}

/**
 * How the Loader gates one entry. `disabled` is the single interpolated
 * metadata field, so an expression there is decided per mount decision and
 * neither state can be assumed.
 * @param entry - one Loader entry or patch row.
 * @returns whether the row always mounts, may mount, or never mounts.
 */
function mountState(entry: Record<string, unknown>): MountState {
  const disabled = entry.disabled
  if (disabled === undefined) return 'always'
  if (isJsExpr(disabled)) return 'conditional'
  return Boolean(disabled) ? 'never' : 'always'
}

/**
 * Whether one budget-policy `Config` value sets a cap. The Loader interpolates
 * plugin `config`, so an expression is a configured cap the gate cannot read.
 * @param value - the parsed cap field.
 * @returns true when the field carries a cap.
 */
function isCap(value: unknown): boolean {
  return typeof value === 'number' || isJsExpr(value)
}
