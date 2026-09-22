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

/** A PEM private-key label: `PRIVATE KEY` after at most three algorithm words, or PGP's `PRIVATE KEY BLOCK`. */
const PEM_LABEL = String.raw`(?:[A-Z0-9]+ ){0,3}PRIVATE KEY(?: BLOCK)?`

/**
 * Whitespace between an armor line and the body, including the `\n` escape a
 * JSON-encoded key carries. Bounded, so a whitespace run after an armor line is
 * never rescanned without limit.
 */
const PEM_GAP = String.raw`(?:\s|\\[nrt]){0,32}`

/** One body line: base64, or a legacy `Proc-Type:`/`DEK-Info:` header line, and never the start of another armor line. */
const PEM_LINE = String.raw`(?:(?!-----)[A-Za-z0-9+/=:,-])+(?:(?<=:) [A-Za-z0-9,-]+)?`

/** Breaks between body lines, raw or JSON-escaped, with the indentation a YAML block scalar keeps. */
const PEM_BREAK = String.raw`(?:[\t ]*(?:\r?\n|\\r\\n|\\n))+[\t ]*`

/**
 * The rules this package owns, applied ahead of a profile's own when it sets
 * `shipped: true`. Each covers one credential or identifier format that turns
 * up verbatim in agent transcripts; none of them claims to be exhaustive, and a
 * deployment adds its own formats through `rules`. The credential formats run
 * before the generic rules, so a key body or a token is replaced whole and
 * counted under its own rule before a generic pattern could match part of it.
 */
export const SHIPPED_REDACTION_RULES: readonly RedactionRule[] = [
  {
    id: 'shipped:private-key',
    // Only the body is matched, so both armor lines stay and name the key
    // type. A body followed by its END line is replaced up to that line
    // without crossing another BEGIN line; a body whose END line is missing,
    // as a truncated tool output leaves it, is replaced while its lines still
    // read as base64 or as a legacy encryption header.
    pattern: String.raw`(?<=-----BEGIN ${PEM_LABEL}-----${PEM_GAP})(?:(?!-----END |\\[nrt])\S(?:(?!-----BEGIN )[\s\S])*?(?=${PEM_GAP}-----END ${PEM_LABEL}-----)|${PEM_LINE}(?:${PEM_BREAK}${PEM_LINE})*)`,
    flags: 'g',
    replacement: '[redacted:private-key]',
  },
  {
    id: 'shipped:jwt',
    // A header and a payload that are both base64url JSON objects, then the
    // signature, which an unsecured token leaves empty.
    pattern: String.raw`\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*`,
    flags: 'g',
    replacement: '[redacted:jwt]',
  },
  {
    id: 'shipped:aws-access-key',
    // Long-term (`AKIA`) and temporary (`ASIA`) access key ids.
    pattern: String.raw`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`,
    flags: 'g',
    replacement: '[redacted:aws-access-key]',
  },
  {
    id: 'shipped:aws-secret-key',
    // The forty-character secret has no prefix of its own, so only a value
    // written under its name is matched: a credentials file, an environment
    // assignment, or the `SecretAccessKey` field of the CLI's JSON.
    pattern: String.raw`(?<=\b(?:aws_?)?secret_?access_?key["']?\s*[:=]\s*["']?)[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+])`,
    flags: 'gi',
    replacement: '[redacted:aws-secret-key]',
  },
  {
    id: 'shipped:github-token',
    pattern: String.raw`\b(?:gh[oprsu]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})`,
    flags: 'g',
    replacement: '[redacted:github-token]',
  },
  {
    id: 'shipped:slack-token',
    pattern: String.raw`\bxox[abprs]-[A-Za-z0-9-]{10,}`,
    flags: 'g',
    replacement: '[redacted:slack-token]',
  },
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
    // A dotted quad is not matched inside a longer run of dotted numbers, which
    // is a version string (`1.2.3.4.5`), and the word boundary already keeps a
    // `v`-prefixed one (`v1.2.3.4`). A bare four-part version whose parts are
    // all at most 255 still reads as an address.
    pattern: String.raw`(?<!\d\.)\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b(?!\.\d)`,
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
 * Record subtrees that carry only identifiers, digests, counts, and closed
 * vocabularies. Nothing under `terms` (the agreement and the purposes it
 * admits), `environment` (the `environment/run` stamp), `steps`, `parity`, or
 * `provenance` is free text, and redacting one of them would break the keys a
 * scoreboard and a decontamination check are computed from, or the terms a
 * later consumer re-checks this export's purpose against.
 */
const NEVER_REDACTED_SUBTREES: ReadonlySet<string> = new Set(['terms', 'environment', 'steps', 'parity', 'provenance'])

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
  'stopReason',
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
