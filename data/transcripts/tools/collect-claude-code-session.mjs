#!/usr/bin/env node
// Snapshots one Claude Code session into a raw transcript tree under
// data/transcripts/: the orchestrating session's JSONL, every subagent
// transcript it spawned, and the overflowed tool results it saved to disk,
// plus a manifest of byte sizes and SHA-256 digests. Node built-ins only.
//
// Usage:
//   node collect-claude-code-session.mjs --out <dir> [--session <id>] [--projects-dir <dir>]
//                                        [--accept-hit <sha256>]... [--redact <pattern>]...
//
//   --out           destination directory, e.g. data/transcripts/2026-09-06-build/raw
//   --session       session id; defaults to $CLAUDE_CODE_SESSION_ID
//   --projects-dir  Claude Code project directory holding <session>.jsonl and
//                   <session>/{subagents,tool-results}; defaults to
//                   ~/.claude/projects/<cwd with every non-alphanumeric byte as "-">
//   --accept-hit    SHA-256 of one credential-shaped match reviewed as a
//                   placeholder to keep verbatim (printed by a refused run); repeatable
//   --redact        name of a SECRET_PATTERNS entry whose matches are replaced by
//                   `[REDACTED-<PATTERN>]` in the written copy instead of being
//                   refused; repeatable. Use it for a real credential that appears
//                   in the transcript (the operator's own key echoed in a message),
//                   which must never be kept verbatim, so the transcript can still
//                   be preserved with the secret masked.
//
// A credential-shaped match is handled in one of three ways: a `--redact` of its
// pattern masks it, an `--accept-hit` of its digest keeps it verbatim (for a
// reviewed placeholder), and anything else refuses the write — the run prints
// every unhandled match with its digest and exits 1. After writing, the tree is
// re-scanned and any credential shape that is not an accepted placeholder aborts
// the run and removes the tree, so a redaction miss can never ship a secret.
// Files above MAX_PART_BYTES are written as line-split parts so no single blob
// exceeds GitHub's per-file ceiling; the manifest records the whole file's
// digest, the part list, and what was redacted. A re-run over unchanged sources
// leaves the tree untouched.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const MAX_PART_BYTES = 40 * 1024 * 1024
const REPO_DIR = resolve(import.meta.dirname, '..', '..', '..')

/** Credential-shaped text. Every match must be reviewed and accepted by digest before a snapshot is written. */
const SECRET_PATTERNS = [
  { name: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'openrouter-key', re: /\bsk-or-v1-[A-Za-z0-9]{20,}/g },
  { name: 'openai-style-key', re: /\bsk-(?:proj-)?[A-Za-z0-9]{20,}/g },
  { name: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: 'bearer-token', re: /\bBearer [A-Za-z0-9._~+/=-]{20,}/g },
]

/** SECRET_PATTERNS entry names, for validating --redact. */
const SECRET_PATTERN_NAMES = new Set(SECRET_PATTERNS.map(pattern => pattern.name))

/**
 * Parses the command line.
 * @param {string[]} argv arguments after the script path
 * @returns {{ out: string, session: string, projectsDir: string, acceptedHits: Set<string>, redact: Set<string> }}
 */
function parseArgs(argv) {
  const options = { out: undefined, session: process.env.CLAUDE_CODE_SESSION_ID, projectsDir: undefined, acceptedHits: new Set(), redact: new Set() }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = argv[i + 1]
    if (arg === '--out') { options.out = value; i++ }
    else if (arg === '--session') { options.session = value; i++ }
    else if (arg === '--projects-dir') { options.projectsDir = value; i++ }
    else if (arg === '--accept-hit') { options.acceptedHits.add(value); i++ }
    else if (arg === '--redact') {
      if (!SECRET_PATTERN_NAMES.has(value)) {
        throw new Error(`--redact ${value ?? ''}: unknown pattern; one of ${[...SECRET_PATTERN_NAMES].join(', ')}`)
      }
      options.redact.add(value); i++
    }
    else throw new Error(`unknown argument ${arg}`)
  }
  if (options.out === undefined) throw new Error('--out <dir> is required')
  if (options.session === undefined) throw new Error('--session <id> is required when CLAUDE_CODE_SESSION_ID is unset')
  if (options.projectsDir === undefined) {
    options.projectsDir = join(homedir(), '.claude', 'projects', process.cwd().replace(/[^A-Za-z0-9]/g, '-'))
  }
  return options
}

/** The marker one redacted match becomes; distinct from every SECRET_PATTERNS shape. */
const redactionMarker = (pattern) => `[REDACTED-${pattern.toUpperCase()}]`

/**
 * Replaces the matches of the named patterns with their marker.
 * @param {string} text file content
 * @param {Set<string>} redact SECRET_PATTERNS names to mask
 * @returns {{ text: string, counts: Record<string, number> }} the masked text and how many matches each named pattern replaced
 */
function redactText(text, redact) {
  const counts = {}
  let redacted = text
  for (const { name, re } of SECRET_PATTERNS) {
    if (!redact.has(name)) continue
    const marker = redactionMarker(name)
    redacted = redacted.replace(new RegExp(re.source, re.flags), () => {
      counts[name] = (counts[name] ?? 0) + 1
      return marker
    })
  }
  return { text: redacted, counts }
}

/**
 * @param {Buffer | string} content bytes to digest
 * @returns {string} lowercase hex SHA-256
 */
function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Lists the session's source files in a stable order.
 * @param {string} projectsDir Claude Code project directory
 * @param {string} session session id
 * @returns {{ source: string, target: string }[]} absolute source path and out-relative target path
 */
function listSourceFiles(projectsDir, session) {
  const orchestrator = join(projectsDir, `${session}.jsonl`)
  if (!existsSync(orchestrator)) throw new Error(`no session transcript at ${orchestrator}`)
  const files = [{ source: orchestrator, target: 'orchestrator-session.jsonl' }]
  for (const group of ['subagents', 'tool-results']) {
    const dir = join(projectsDir, session, group)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir).sort()) {
      if (!statSync(join(dir, name)).isFile()) continue
      files.push({ source: join(dir, name), target: `${group}/${name}` })
    }
  }
  return files
}

/**
 * Finds credential-shaped matches in one file.
 * @param {string} target out-relative path, for the report
 * @param {string} text file content
 * @returns {{ target: string, line: number, pattern: string, digest: string, preview: string }[]}
 */
function scanSecrets(target, text) {
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

/**
 * Splits text at line boundaries into parts of at most MAX_PART_BYTES.
 * @param {string} text complete file content
 * @returns {string[]} parts whose concatenation is the input
 */
function splitLines(text) {
  const parts = []
  let current = ''
  let currentBytes = 0
  for (const line of text.split(/(?<=\n)/)) {
    const bytes = Buffer.byteLength(line, 'utf8')
    if (currentBytes + bytes > MAX_PART_BYTES && current !== '') {
      parts.push(current)
      current = ''
      currentBytes = 0
    }
    current += line
    currentBytes += bytes
  }
  if (current !== '') parts.push(current)
  return parts
}

/**
 * Reads the repository branch and head for the manifest.
 * @returns {{ branch: string, head: string }}
 */
function readRepository() {
  const git = (args) => execFileSync('git', ['-C', REPO_DIR, ...args], { encoding: 'utf8' }).trim()
  return { branch: git(['branch', '--show-current']), head: git(['rev-parse', 'HEAD']) }
}

function main() {
  const { out, session, projectsDir, acceptedHits, redact } = parseArgs(process.argv.slice(2))
  const outDir = resolve(out)
  const files = listSourceFiles(projectsDir, session)

  const entries = []
  const refused = []
  const redactions = []
  for (const { source, target } of files) {
    const source_text = readFileSync(source, 'utf8')
    // Mask the --redact patterns first, then scan what remains: a redacted
    // secret is gone before it can be refused, and anything left must still be
    // an accepted placeholder or the run refuses.
    const { text, counts } = redact.size > 0 ? redactText(source_text, redact) : { text: source_text, counts: {} }
    for (const [pattern, count] of Object.entries(counts)) redactions.push({ target, pattern, count })
    for (const hit of scanSecrets(target, text)) {
      if (!acceptedHits.has(hit.digest)) refused.push(hit)
    }
    entries.push({ target, text, bytes: Buffer.byteLength(text, 'utf8'), sha256: sha256(text) })
  }
  if (refused.length > 0) {
    console.error(`refusing to write ${outDir}: ${refused.length} credential-shaped match(es) without --accept-hit or --redact`)
    for (const hit of refused) console.error(`  ${hit.target}:${hit.line} ${hit.pattern} ${hit.preview} --accept-hit ${hit.digest} (or --redact ${hit.pattern})`)
    process.exit(1)
  }

  const manifestFiles = entries.map(({ target, bytes, sha256: digest, text }) => {
    const parts = bytes > MAX_PART_BYTES ? splitLines(text) : undefined
    const partNames = parts?.map((_, index) => target.replace(/\.jsonl$/, `.part-${String(index).padStart(2, '0')}.jsonl`))
    return { path: target, bytes, sha256: digest, ...(partNames === undefined ? {} : { parts: partNames }), text, partBodies: parts }
  })
  const manifest = {
    sessionId: session,
    sourceDir: projectsDir,
    repository: readRepository(),
    acceptedHits: [...acceptedHits].sort(),
    ...(redactions.length === 0 ? {} : { redactions: { patterns: [...redact].sort(), files: redactions } }),
    files: manifestFiles.map(({ text: _text, partBodies: _parts, ...entry }) => entry),
  }

  const manifestPath = join(outDir, 'manifest.json')
  if (existsSync(manifestPath)) {
    const { collectedAt: _collectedAt, ...previous } = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (JSON.stringify(previous) === JSON.stringify(manifest)) {
      console.log(`unchanged: ${relative(REPO_DIR, outDir)} already holds this session's current transcripts`)
      return
    }
    rmSync(outDir, { recursive: true, force: true })
  }

  for (const entry of manifestFiles) {
    if (entry.partBodies === undefined) {
      const path = join(outDir, entry.path)
      mkdirSync(join(path, '..'), { recursive: true })
      writeFileSync(path, entry.text)
    } else {
      for (const [index, body] of entry.partBodies.entries()) {
        const path = join(outDir, entry.parts[index])
        mkdirSync(join(path, '..'), { recursive: true })
        writeFileSync(path, body)
      }
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify({ collectedAt: new Date().toISOString(), ...manifest }, null, 2)}\n`)

  // Prove no secret shipped: re-scan every written blob and abort on any match
  // that is not an accepted placeholder, so a redaction gap removes the tree
  // rather than committing a key.
  const survived = []
  for (const entry of manifestFiles) {
    const paths = entry.partBodies === undefined ? [entry.path] : entry.parts
    for (const path of paths) {
      for (const hit of scanSecrets(path, readFileSync(join(outDir, path), 'utf8'))) {
        if (!acceptedHits.has(hit.digest)) survived.push(hit)
      }
    }
  }
  if (survived.length > 0) {
    rmSync(outDir, { recursive: true, force: true })
    console.error(`removed ${outDir}: ${survived.length} credential-shaped match(es) survived redaction`)
    for (const hit of survived) console.error(`  ${hit.target}:${hit.line} ${hit.pattern} ${hit.preview}`)
    process.exit(1)
  }

  const totalBytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0)
  console.log(`wrote ${manifest.files.length} files (${(totalBytes / 1024 / 1024).toFixed(1)} MiB) to ${relative(REPO_DIR, outDir)} for session ${session}`)
  console.log(`  orchestrator: ${basename(files[0].source)}; subagents: ${manifest.files.filter(f => f.path.startsWith('subagents/')).length}; tool results: ${manifest.files.filter(f => f.path.startsWith('tool-results/')).length}`)
}

main()
