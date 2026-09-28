// Credential detection and redaction shared by collect-claude-code-session.mjs
// and capture-live.mjs, so the archive and the live capture recognise the same
// credential shapes and mask them the same way. Node built-ins only.

import { createHash } from 'node:crypto'

// A distinctive prefix (`sk-or-v1-`, `ghp_`, `AKIA`, `xox`, `Bearer `) carries no
// leading `\b`: a secret often follows a JSON-escaped newline, whose trailing
// `n` is a word character, so a leading `\b` would defeat both the redaction and
// the re-scan. `openai-style-key` keeps its `\b` because the bare `sk-` prefix
// would otherwise match inside words like `task` or `risk`.
/** Credential-shaped text. A match is redacted, or kept verbatim only when its digest is an accepted placeholder. */
export const SECRET_PATTERNS = [
  { name: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'openrouter-key', re: /sk-or-v1-[A-Za-z0-9]{20,}/g },
  { name: 'openai-style-key', re: /\bsk-(?:proj-)?[A-Za-z0-9]{20,}/g },
  { name: 'github-token', re: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}/g },
  { name: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/g },
  { name: 'slack-token', re: /xox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: 'bearer-token', re: /Bearer [A-Za-z0-9._~+/=-]{20,}/g },
]

/** SECRET_PATTERNS entry names. */
export const SECRET_PATTERN_NAMES = new Set(SECRET_PATTERNS.map(pattern => pattern.name))

/**
 * @param {Buffer | string} content bytes to digest
 * @returns {string} lowercase hex SHA-256
 */
export function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * The marker one redacted match becomes; distinct from every SECRET_PATTERNS shape.
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
 * Replaces the matches of the named patterns with their marker.
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
 * Finds credential-shaped matches in one file.
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
