// Credential and personal-data detection and redaction shared by every tool
// that publishes transcripts or agent text: the transcript collector
// (collect-claude-code-session.mjs), the live capture (capture-live.mjs), the
// intake admission (scripts/enterprise-intake-admission.ts), the bench
// preflight (data/proving-ground/tools/preflight.mjs), and the code-safety
// record (data/code-safety/tools/record-run.mjs). They recognise the same
// shapes and mask them the same way. Node built-ins only.

import { createHash } from 'node:crypto'

// A distinctive prefix (`sk-or-v1-`, `ghp_`, `AKIA`, `xox`, `Bearer `) carries no
// leading `\b`: a secret often follows a JSON-escaped newline, whose trailing
// `n` is a word character, so a leading `\b` would defeat both the redaction and
// the re-scan. `openai-style-key` keeps its `\b` because the bare `sk-` prefix
// would otherwise match inside words like `task` or `risk`. The short `hf_` and
// `e2b_` prefixes start only where no letter, digit or `_` precedes them, or
// right after a JSON escape (`\n`, `\r`, `\t`), so a run of base64url text or a
// longer identifier does not match. A match's text, and so its digest, is part
// of the accepted-placeholder contract: a reviewed placeholder stays verbatim
// only while its pattern still matches exactly the same characters.
//
// An e-mail match never starts right after a backslash or inside a `\uXXXX`
// escape, so masking one in a JSON string (a `\n` or `\u003c` before the
// address) leaves the escape whole and the line parseable. The local part is
// at most 64 characters and starts only where no local-part character precedes
// it, which keeps the scan linear over long base64 runs. The domain ends in an
// alphabetic label of two letters or more, so `name@1.2.3` version pins, git
// SHAs, UUIDs and base64 never match. Phone numbers are not detected: every
// shape that finds them also matches the timestamps, byte counts, token counts
// and numeric ids transcripts carry (data/transcripts/README.md).
//
// The AWS secret access key has no prefix: it is the 40-character base64 value
// right after an access key id (or its redaction marker, so the order in which
// the patterns run cannot hide it) or after the words `aws_secret_access_key` /
// `SecretAccessKey`, across the quotes, colons, equals signs and escapes that
// JSON, shell and INI files put between them.
/**
 * Credential- and personal-data-shaped text. `kind` is `credential` for a
 * secret and `personal` for personal data. A match is redacted, or kept
 * verbatim only when its digest is an accepted placeholder.
 */
export const SECRET_PATTERNS = [
  { name: 'anthropic-key', kind: 'credential', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'openrouter-key', kind: 'credential', re: /sk-or-v1-[A-Za-z0-9]{20,}/g },
  { name: 'openai-style-key', kind: 'credential', re: /\bsk-(?:proj-)?[A-Za-z0-9]{20,}/g },
  { name: 'github-token', kind: 'credential', re: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}/g },
  { name: 'huggingface-token', kind: 'credential', re: /(?:(?<=\\[nrt])|(?<![A-Za-z0-9_]))hf_[A-Za-z0-9]{30,}/g },
  { name: 'e2b-key', kind: 'credential', re: /(?:(?<=\\[nrt])|(?<![A-Za-z0-9_]))e2b_[A-Za-z0-9]{20,}/g },
  { name: 'aws-secret-key', kind: 'credential', re: /(?<=(?:(?:aws[_-]?)?secret[_-]?access[_-]?key|AKIA[0-9A-Z]{16}|\[REDACTED-AWS-ACCESS-KEY\])[\s"'\\:=,|]{1,12})(?<!\\)[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+=])/gi },
  { name: 'aws-access-key', kind: 'credential', re: /AKIA[0-9A-Z]{16}/g },
  { name: 'slack-token', kind: 'credential', re: /xox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'private-key', kind: 'credential', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: 'bearer-token', kind: 'credential', re: /[Bb]earer[ \t]+[A-Za-z0-9._~+/=-]{20,}/g },
  { name: 'email', kind: 'personal', re: /(?:(?<![\w.%+\\-])|(?<=\\[nrtbf])|(?<=\\u[0-9A-Fa-f]{4}))[\w.%+-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}/g },
]

/** SECRET_PATTERNS entry names. */
export const SECRET_PATTERN_NAMES = new Set(SECRET_PATTERNS.map(pattern => pattern.name))

/** SECRET_PATTERNS names of `kind: 'credential'`. */
export const CREDENTIAL_PATTERN_NAMES = new Set(SECRET_PATTERNS.filter(pattern => pattern.kind === 'credential').map(pattern => pattern.name))

/** SECRET_PATTERNS names of `kind: 'personal'`. */
export const PERSONAL_PATTERN_NAMES = new Set(SECRET_PATTERNS.filter(pattern => pattern.kind === 'personal').map(pattern => pattern.name))

/**
 * @param {Buffer | string} content bytes to digest
 * @returns {string} lowercase hex SHA-256
 */
export function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * The marker one redacted match becomes; distinct from every SECRET_PATTERNS
 * shape, and free of quotes and backslashes, so masking a JSON document keeps
 * it JSON.
 * @param {string} pattern SECRET_PATTERNS name
 * @returns {string} `[REDACTED-<PATTERN>]`
 */
export const redactionMarker = (pattern) => `[REDACTED-${pattern.toUpperCase()}]`

// The `private-key` SECRET_PATTERNS entry matches only the BEGIN marker, which
// detects a key but would leave its body when redacting. The whole BEGIN…END
// block (the body may not cross a JSON string boundary or another PEM marker,
// so a BEGIN line quoted on its own does not extend it) collapses to one marker
// so no marker or body line survives the re-scan.
/** One whole PEM private-key block, BEGIN to END. */
export const PRIVATE_KEY_BLOCK = /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----(?:(?!-----)[^"])*?-----END (?:[A-Z]+ )*PRIVATE KEY-----/g
/** A PEM private-key BEGIN marker left without its END. */
export const PRIVATE_KEY_MARKER_LINE = /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/g

/**
 * Replaces the matches of the named patterns with their marker, in
 * SECRET_PATTERNS order.
 * @param {string} text file content
 * @param {Set<string>} redact SECRET_PATTERNS names to mask
 * @param {Set<string>} [keep] SHA-256 digests of reviewed placeholders left verbatim
 * @returns {{ text: string, counts: Record<string, number> }} the masked text and how many matches each named pattern replaced
 */
export function redactText(text, redact, keep = new Set()) {
  const counts = {}
  let redacted = text
  const replace = (name, pattern) => {
    const marker = redactionMarker(name)
    redacted = redacted.replace(new RegExp(pattern.source, pattern.flags), (match) => {
      if (keep.size > 0 && keep.has(sha256(match))) return match
      counts[name] = (counts[name] ?? 0) + 1
      return marker
    })
  }
  if (redact.has('private-key')) {
    // The whole block first, then any BEGIN marker left with no END in range (a
    // key a tool cut off, or a search hit that quotes only the marker line).
    replace('private-key', PRIVATE_KEY_BLOCK)
    replace('private-key', PRIVATE_KEY_MARKER_LINE)
  }
  for (const { name, re } of SECRET_PATTERNS) {
    if (!redact.has(name) || name === 'private-key') continue
    replace(name, re)
  }
  return { text: redacted, counts }
}

/**
 * Finds credential- and personal-data-shaped matches in one file, line by line.
 * @param {string} target path named in the report
 * @param {string} text file content
 * @returns {{ target: string, line: number, pattern: string, digest: string, preview: string }[]} every match, with its 1-based line and SHA-256
 */
export function scanSecrets(target, text) {
  const hits = []
  const lines = text.split('\n')
  for (const [index, line] of lines.entries()) {
    for (const { name, re } of SECRET_PATTERNS) {
      for (const match of line.matchAll(re)) {
        hits.push({ target, line: index + 1, pattern: name, digest: sha256(match[0]), preview: `${match[0].slice(0, 12)}…` })
      }
    }
  }
  return hits
}
