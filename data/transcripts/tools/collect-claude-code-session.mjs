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
//   --accept-hit    SHA-256 of one credential- or e-mail-shaped match reviewed as a
//                   placeholder to keep verbatim (printed by a refused run); repeatable
//   --redact        name of a SECRET_PATTERNS entry whose matches are replaced by
//                   `[REDACTED-<PATTERN>]` in the written copy instead of being
//                   refused; repeatable. Use it for a real credential that appears
//                   in the transcript (the operator's own key echoed in a message)
//                   and for `email` (the operator's address the context reminders
//                   carry), which must never be kept verbatim, so the transcript
//                   can still be preserved with the secret or address masked.
//
// A credential- or e-mail-shaped match is handled in one of three ways: a
// `--redact` of its pattern masks it, an `--accept-hit` of its digest keeps it
// verbatim (for a reviewed placeholder), and anything else refuses the write —
// the run prints every unhandled match with its digest and exits 1. After
// writing, the tree is re-scanned and any match that is not an accepted
// placeholder aborts the run and removes the tree, so a redaction miss can
// never ship a secret or an address.
// The patterns and the redaction are secret-patterns.mjs, shared with
// capture-live.mjs. Files above MAX_PART_BYTES are written as line-split parts so no single blob
// exceeds GitHub's per-file ceiling; the manifest records the whole file's
// digest, the part list, and what was redacted. A re-run over unchanged sources
// leaves the tree untouched.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { SECRET_PATTERN_NAMES, redactText, scanSecrets, sha256 } from './secret-patterns.mjs'

const MAX_PART_BYTES = 40 * 1024 * 1024
const REPO_DIR = resolve(import.meta.dirname, '..', '..', '..')

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
    console.error(`refusing to write ${outDir}: ${refused.length} credential- or e-mail-shaped match(es) without --accept-hit or --redact`)
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

  // Prove no secret or address shipped: re-scan every written blob and abort on
  // any match that is not an accepted placeholder, so a redaction gap removes
  // the tree rather than committing a key.
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
    console.error(`removed ${outDir}: ${survived.length} credential- or e-mail-shaped match(es) survived redaction`)
    for (const hit of survived) console.error(`  ${hit.target}:${hit.line} ${hit.pattern} ${hit.preview}`)
    process.exit(1)
  }

  const totalBytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0)
  console.log(`wrote ${manifest.files.length} files (${(totalBytes / 1024 / 1024).toFixed(1)} MiB) to ${relative(REPO_DIR, outDir)} for session ${session}`)
  console.log(`  orchestrator: ${basename(files[0].source)}; subagents: ${manifest.files.filter(f => f.path.startsWith('subagents/')).length}; tool results: ${manifest.files.filter(f => f.path.startsWith('tool-results/')).length}`)
}

main()
