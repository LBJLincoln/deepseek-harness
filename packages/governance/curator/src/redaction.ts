/**
 * Redaction profiles and the walk that applies one to a trajectory record: the
 * rule set this package ships, the load-time compilation every configured rule
 * passes, and the enumeration of what a record never has redacted.
 * @module @deepseek-ai/dsh-curator
 */

import { createHash } from 'node:crypto'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { Trajectory } from '@deepseek-ai/dsh-trajectories/types'
import type { RedactionProfileConfig, RedactionRule } from './types.ts'

/** Stable error codes of a refused profile or a refused export. */
export type CuratorErrorCode =
  | 'CURATOR_INVALID_CONFIG'
  | 'CURATOR_PROFILE_REQUIRED'
  | 'CURATOR_PROFILE_UNKNOWN'
  | 'CURATOR_UNADMITTED_RECORD'

/** Error raised by a profile the curator cannot compile or an export it refuses to run. */
export class CuratorError extends HarnessError {
  /**
   * @param message - human-readable reason, naming the profile or rule at fault.
   * @param code - stable machine-routable classification.
   */
  // Keep the constructor to narrow HarnessError's string code at this boundary.
  // oxlint-disable-next-line typescript/no-useless-constructor -- type-only narrowing
  constructor(message: string, code: CuratorErrorCode) {
    super(message, code)
  }
}

/**
 * The rules this package owns, applied ahead of a profile's own when it sets
 * `shipped: true`. Each covers one credential or identifier format that turns
 * up verbatim in agent transcripts; none of them claims to be exhaustive, and a
 * deployment adds its own formats through `rules`.
 */
export const SHIPPED_REDACTION_RULES: readonly RedactionRule[] = [
  {
    id: 'shipped:email',
    pattern: String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`,
    flags: 'g',
    replacement: '[redacted:email]',
  },
  {
    id: 'shipped:bearer-token',
    // Twenty characters keeps the prose "Bearer token" out of the rule while
    // matching every credential an Authorization header actually carries.
    pattern: String.raw`\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*`,
    flags: 'gi',
    replacement: 'Bearer [redacted:token]',
  },
  {
    id: 'shipped:api-key',
    pattern: String.raw`\bsk-[A-Za-z0-9_-]{4,}\b`,
    flags: 'g',
    replacement: '[redacted:api-key]',
  },
  {
    id: 'shipped:ipv4',
    pattern: String.raw`\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b`,
    flags: 'g',
    replacement: '[redacted:ipv4]',
  },
  {
    id: 'shipped:e164-phone',
    pattern: String.raw`\+[1-9]\d{7,14}\b`,
    flags: 'g',
    replacement: '[redacted:phone]',
  },
]

/**
 * Record subtrees that carry only identifiers, digests, and counts. Nothing
 * under `environment` (the `environment/run` stamp), `steps`, `parity`, or
 * `provenance` is free text, and redacting one of them would break the keys a
 * scoreboard and a decontamination check are computed from.
 */
const NEVER_REDACTED_SUBTREES: ReadonlySet<string> = new Set(['environment', 'steps', 'parity', 'provenance'])

/**
 * Key names that hold an identifier or a closed vocabulary wherever they appear
 * in the record. A rule that rewrote one of these would corrupt a value the
 * record's readers switch on rather than protect anything the record carries.
 */
const NEVER_REDACTED_KEYS: ReadonlySet<string> = new Set([
  'format',
  'type',
  'id',
  'sessionId',
  'parentSession',
  'agentPreset',
  'role',
  'sourceKind',
  'toolCallId',
  'basis',
  'phase',
  'goalId',
  'checkId',
  'status',
  'isolation',
  'executor',
  'provider',
  'model',
  'reasoningEffort',
  'attachmentId',
  'mediaType',
])

/**
 * Paths whose `name` is a registered tool name rather than free text. The key
 * alone cannot decide it: an attachment's `name` is a display filename and is
 * redacted like any other text a person supplied.
 */
const NEVER_REDACTED_PATHS: ReadonlySet<string> = new Set([
  'tools.name',
  'messages.content.name',
  'messages.toolCalls.name',
])

/** Where one string sits in the record; array indices are elided, so every element of a list shares its path. */
interface RedactionSite {
  /** Top-level record key the string descends from. */
  readonly root: string
  /** Dotted path from the record root, indices elided. */
  readonly path: string
  /** Key the string is stored under. */
  readonly key: string
}

/** One rule ready to run, with the regular expression the load compiled. */
export interface CompiledRedactionRule {
  /** The configured rule id, which hit counts are reported under. */
  readonly id: string
  /** The compiled pattern, always global so every hit is replaced and counted. */
  readonly regex: RegExp
  /** Literal replacement text. */
  readonly replacement: string
}

/** A profile as the service holds it: its rules in run order and the digest that addresses them. */
export interface RedactionProfile {
  /** Configured profile id. */
  readonly id: string
  /** Shipped rules first when the profile asked for them, then the configured ones. */
  readonly rules: readonly CompiledRedactionRule[]
  /** Lowercase SHA-256 hex over the rules' sources, flags, and replacements in order. */
  readonly sha256: string
}

/**
 * Compile one configured profile, refusing every rule a load may not accept.
 * @param id - the profile id, named in every rejection.
 * @param config - the profile's shipped-rule choice and its own rules.
 * @returns the compiled profile with its digest.
 * @throws {@link CuratorError} `CURATOR_INVALID_CONFIG` when the profile holds
 *   no rule, or when a rule has an empty id, an id another rule in the same
 *   profile already used, the sticky flag, or a pattern that does not compile.
 */
export function compileProfile(id: string, config: RedactionProfileConfig): RedactionProfile {
  const rules = [...config.shipped ? SHIPPED_REDACTION_RULES : [], ...config.rules ?? []]
  if (rules.length === 0) {
    throw new CuratorError(
      `redaction profile "${id}" lists no rule and does not take the shipped set, so it would redact nothing`,
      'CURATOR_INVALID_CONFIG',
    )
  }
  const seen = new Set<string>()
  const compiled = rules.map((rule) => {
    if (rule.id.length === 0) throw new CuratorError(`redaction profile "${id}" has a rule with an empty id`, 'CURATOR_INVALID_CONFIG')
    if (seen.has(rule.id)) {
      throw new CuratorError(`redaction profile "${id}" lists rule "${rule.id}" twice, so its hit count would name two rules`, 'CURATOR_INVALID_CONFIG')
    }
    seen.add(rule.id)
    return { id: rule.id, regex: compileRule(id, rule), replacement: rule.replacement }
  })
  return { id, rules: compiled, sha256: profileDigest(compiled) }
}

/**
 * Compile one rule's pattern, always globally.
 * @param profileId - owning profile, named in a rejection.
 * @param rule - the configured rule.
 * @returns the compiled expression.
 * @throws {@link CuratorError} on the sticky flag or an uncompilable pattern.
 */
function compileRule(profileId: string, rule: RedactionRule): RegExp {
  const flags = rule.flags ?? ''
  if (flags.includes('y')) {
    throw new CuratorError(
      `redaction rule "${rule.id}" of profile "${profileId}" sets the sticky flag, which would match only at the expression's last index and leave later hits in the record`,
      'CURATOR_INVALID_CONFIG',
    )
  }
  try {
    return new RegExp(rule.pattern, flags.includes('g') ? flags : `${flags}g`)
  } catch (error: unknown) {
    // The RegExp constructor is the only thrower here and it throws a SyntaxError.
    throw new CuratorError(`redaction rule "${rule.id}" of profile "${profileId}" does not compile: ${String(error)}`, 'CURATOR_INVALID_CONFIG')
  }
}

/**
 * Digest the rules that will actually run, so a manifest states which rules a
 * profile name stood for rather than only the name.
 * @param rules - the compiled rules in run order.
 * @returns lowercase SHA-256 hex over their canonical encoding.
 */
function profileDigest(rules: readonly CompiledRedactionRule[]): string {
  const canonical = rules.map(rule => ({
    id: rule.id,
    source: rule.regex.source,
    flags: rule.regex.flags,
    replacement: rule.replacement,
  }))
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

/**
 * Replace every match of every rule, in rule order, counting the replacements.
 * The replacement is returned from a function, so a `$&` or `$1` a deployment
 * configured is written literally and can never splice the matched text back in.
 * @param text - the string to redact.
 * @param rules - the profile's rules in run order.
 * @param hits - replacement counts per rule id, incremented in place.
 * @returns the redacted string.
 */
export function applyRules(text: string, rules: readonly CompiledRedactionRule[], hits: Map<string, number>): string {
  let redacted = text
  for (const rule of rules) {
    redacted = redacted.replace(rule.regex, () => {
      hits.set(rule.id, (hits.get(rule.id) ?? 0) + 1)
      return rule.replacement
    })
  }
  return redacted
}

/**
 * Whether one string keeps its exact value.
 * @param site - where the string sits in the record.
 * @returns true for the record's identifiers, discriminants, and tool names.
 */
function keeps(site: RedactionSite): boolean {
  return NEVER_REDACTED_SUBTREES.has(site.root)
    || NEVER_REDACTED_KEYS.has(site.key)
    || NEVER_REDACTED_PATHS.has(site.path)
}

/**
 * Redact one value and everything under it.
 * @param value - the value at `site`.
 * @param site - where the value sits in the record.
 * @param rules - the profile's rules in run order.
 * @param hits - replacement counts per rule id, incremented in place.
 * @returns the value with every redacted string replaced.
 */
function redactValue(value: unknown, site: RedactionSite, rules: readonly CompiledRedactionRule[], hits: Map<string, number>): unknown {
  if (typeof value === 'string') return keeps(site) ? value : applyRules(value, rules, hits)
  if (Array.isArray(value)) return value.map(item => redactValue(item, site, rules, hits))
  if (typeof value === 'object' && value !== null) return redactEntries(value, site, rules, hits)
  return value
}

/**
 * Redact every property of one object, descending with the property's path.
 * @param value - the object to walk.
 * @param site - where the object sits, or `undefined` at the record root.
 * @param rules - the profile's rules in run order.
 * @param hits - replacement counts per rule id, incremented in place.
 * @returns a new object with the same keys.
 */
function redactEntries(
  value: object,
  site: RedactionSite | undefined,
  rules: readonly CompiledRedactionRule[],
  hits: Map<string, number>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    redactValue(entry, site === undefined ? { root: key, path: key, key } : { root: site.root, path: `${site.path}.${key}`, key }, rules, hits),
  ]))
}

/**
 * Apply a profile to one trajectory record. Every string is redacted except the
 * record's identifiers, its readers' discriminants, and registered tool names,
 * so a field added to the record format is redacted until someone decides
 * otherwise rather than exported until someone notices.
 * @param record - the folded record, as the exporter serialized it.
 * @param rules - the profile's rules in run order.
 * @param hits - replacement counts per rule id, incremented in place.
 * @returns a new record with the same keys and every redacted string replaced.
 */
export function redactTrajectory(record: Trajectory, rules: readonly CompiledRedactionRule[], hits: Map<string, number>): Trajectory {
  // The walk replaces string leaves and preserves every key, so the result is
  // the same record format with redacted text.
  return redactEntries(record, undefined, rules, hits) as unknown as Trajectory
}
