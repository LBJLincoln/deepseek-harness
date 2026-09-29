// Types of secret-patterns.mjs for its TypeScript importers; the module itself
// stays plain JavaScript so the capture tools run under Node without a build.

/** One SECRET_PATTERNS entry: `credential` for a secret, `personal` for personal data. */
export interface SecretPattern {
  readonly name: string
  readonly kind: 'credential' | 'personal'
  readonly re: RegExp
}

/** Credential- and personal-data-shaped text. A match is redacted, or kept verbatim only when its digest is an accepted placeholder. */
export declare const SECRET_PATTERNS: readonly SecretPattern[]
/** SECRET_PATTERNS entry names. */
export declare const SECRET_PATTERN_NAMES: ReadonlySet<string>
/** SECRET_PATTERNS names of `kind: 'credential'`. */
export declare const CREDENTIAL_PATTERN_NAMES: ReadonlySet<string>
/** SECRET_PATTERNS names of `kind: 'personal'`. */
export declare const PERSONAL_PATTERN_NAMES: ReadonlySet<string>
/** One whole PEM private-key block, BEGIN to END. */
export declare const PRIVATE_KEY_BLOCK: RegExp
/** A PEM private-key BEGIN marker left without its END. */
export declare const PRIVATE_KEY_MARKER_LINE: RegExp

/**
 * @param content - bytes to digest.
 * @returns lowercase hex SHA-256.
 */
export declare function sha256(content: Buffer | string): string

/**
 * The marker one redacted match becomes.
 * @param pattern - SECRET_PATTERNS name.
 * @returns `[REDACTED-<PATTERN>]`.
 */
export declare function redactionMarker(pattern: string): string

/**
 * Replaces the matches of the named patterns with their marker, in SECRET_PATTERNS order.
 * @param text - file content.
 * @param redact - SECRET_PATTERNS names to mask.
 * @param keep - SHA-256 digests of reviewed placeholders left verbatim.
 * @returns the masked text and how many matches each named pattern replaced.
 */
export declare function redactText(text: string, redact: ReadonlySet<string>, keep?: ReadonlySet<string>): { text: string; counts: Record<string, number> }

/** One scanSecrets match. */
export interface SecretHit {
  readonly target: string
  readonly line: number
  readonly pattern: string
  readonly digest: string
  readonly preview: string
}

/**
 * Finds credential- and personal-data-shaped matches in one file, line by line.
 * @param target - path named in the report.
 * @param text - file content.
 * @returns every match, with its 1-based line and SHA-256.
 */
export declare function scanSecrets(target: string, text: string): SecretHit[]
