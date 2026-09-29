#!/usr/bin/env node
// Appends what is new in every live transcript source to data/transcripts/live/
// as immutable, redacted gzip chunks, with one manifest per run. Node built-ins
// only; it runs under plain Node from any checkout of the repository.
//
// Usage:
//   node capture-live.mjs [--live <dir>] [--source <name>:<policy>=<path>]...
//                         [--exclude <regex>]... [--accept-hit <sha256>]...
//                         [--max-file-bytes <n>] [--max-run-bytes <n>]
//                         [--settle-seconds <n>]
//
//   --live            capture directory (default: data/transcripts/live of this checkout)
//   --source          one source root; repeatable, and any use replaces the default
//                     list. <policy> selects the files under <path>:
//                       all       every regular file
//                       sessions  files under a `.sessions` directory, and the regular
//                                 files directly inside each child of <path>
//                       logs      files ending `.log` or `.jsonl`
//                     <path> may also be one regular file. A directory holding `.git`,
//                     and every `.git` and `node_modules` directory, is never entered.
//   --exclude         a regular expression over the absolute path; matching files are
//                     skipped. Repeatable; added to the defaults (`ccr-tip.json`, the
//                     Claude Code remote-sync pointer rewritten every few seconds, and
//                     `transcripts-capture.log`, this capture's own loop log).
//   --accept-hit      SHA-256 of one reviewed placeholder kept verbatim, beside the
//                     `acceptedHits` of every collected build; repeatable
//   --max-file-bytes  new bytes taken from one file per run (default 32 MiB); the rest
//                     is deferred to the next run, cut at a line end
//   --max-run-bytes   new bytes taken per run over all files (default 256 MiB); files
//                     past it are deferred to the next run
//   --settle-seconds  a trailing line with no newline is captured only once the file
//                     has not changed for this long (default 120)
//
// State comes from the committed run manifests alone, so a fresh clone after a
// container reset resumes where the last pushed run stopped. A chunk holds whole
// lines: the bytes from the end of the previous chunk to the last newline, and
// a settled trailing line. When a file no longer starts with the bytes already
// captured (the file shrank, or the SHA-256 of its first captured bytes
// differs), the file begins its next epoch at byte 0; earlier chunks are never
// rewritten. Every credential shape and e-mail address in secret-patterns.mjs
// is masked as `[REDACTED-<PATTERN>]` and counted per pattern in the chunk and
// run manifests, except a match whose
// SHA-256 is an accepted placeholder of a collected build
// (data/transcripts/*/raw/manifest.json `acceptedHits`), which stays verbatim.
// In a plain-text file (anything but `.jsonl`), a PEM private-key block spread
// over lines becomes one marker (the BEGIN line from its marker on; its body
// lines and END marker are dropped), including a block a chunk boundary splits,
// whose continuation is masked at the start of the next chunk. The chunk is re-scanned after masking, and a
// surviving match stops the run before its manifest is written, so the
// capture loop commits nothing from it. Exit 0 when the run captured or found
// nothing new, 1 on any failure.

import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { LIVE_FORMAT, captureState, readRuns } from './live-chunks.mjs'
import { PRIVATE_KEY_MARKER_LINE, SECRET_PATTERN_NAMES, redactText, redactionMarker, scanSecrets, sha256 } from './secret-patterns.mjs'

const REPO_DIR = resolve(import.meta.dirname, '..', '..', '..')
const MIB = 1024 * 1024
const POLICIES = new Set(['all', 'sessions', 'logs'])
const PRIVATE_KEY_END = /-----END (?:[A-Z]+ )*PRIVATE KEY-----/g

/**
 * The default sources: every Claude Code project directory (the operator's
 * session, its subagents and tool results, and every department, reviewer,
 * intake and bench session Claude Code writes), the enterprise's in-flight
 * scratch (shift and intake session logs), the cycle and scheduler logs, and
 * the nightly bench's log and run directories.
 * @param {NodeJS.ProcessEnv} env environment the defaults read
 * @returns {{ name: string, policy: string, path: string }[]} source roots
 */
function defaultSources(env) {
  const claudeDir = env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
  return [
    { name: 'claude-projects', policy: 'all', path: join(claudeDir, 'projects') },
    { name: 'enterprise', policy: 'sessions', path: env.DSH_ENTERPRISE_SCRATCH ?? '/tmp/dsh-enterprise' },
    { name: 'enterprise-cycles', policy: 'logs', path: env.ENTERPRISE_CYCLE_LOGS ?? '/home/user/enterprise-cycles' },
    { name: 'nightly', policy: 'all', path: '/tmp/nightly-loop.log' },
    { name: 'bench-runs', policy: 'logs', path: '/home/user/deepseek-harness/.proving-ground/runs' },
  ]
}

const DEFAULT_EXCLUDES = [/\/ccr-tip\.json$/, /\/transcripts-capture\.log$/]

/**
 * Parses a positive whole number option.
 * @param {string} flag the option, for the error
 * @param {string | undefined} value its argument
 * @returns {number} the parsed value
 */
function wholeNumber(flag, value) {
  if (value === undefined || !/^\d+$/.test(value) || Number(value) < 1) throw new Error(`${flag} needs a whole number above 0, got ${value}`)
  return Number(value)
}

/**
 * Parses the command line.
 * @param {string[]} argv arguments after the script path
 * @param {NodeJS.ProcessEnv} env environment the defaults read
 * @returns {{ live: string, sources: { name: string, policy: string, path: string }[], excludes: RegExp[], maxFileBytes: number, maxRunBytes: number, settleMs: number }} resolved options
 */
function parseArgs(argv, env) {
  const options = { live: join(REPO_DIR, 'data', 'transcripts', 'live'), sources: [], excludes: [...DEFAULT_EXCLUDES], acceptedHits: new Set(), maxFileBytes: 32 * MIB, maxRunBytes: 256 * MIB, settleMs: 120_000 }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = argv[++i]
    if (arg === '--live') options.live = resolve(value)
    else if (arg === '--accept-hit') {
      if (!/^[0-9a-f]{64}$/.test(value ?? '')) throw new Error(`--accept-hit ${value}: expected a lowercase hex SHA-256`)
      options.acceptedHits.add(value)
    }
    else if (arg === '--source') {
      const match = /^([a-z0-9][a-z0-9-]*):([a-z]+)=(.+)$/.exec(value ?? '')
      if (match === null || !POLICIES.has(match[2])) throw new Error(`--source ${value}: expected <name>:<${[...POLICIES].join('|')}>=<path>`)
      options.sources.push({ name: match[1], policy: match[2], path: resolve(match[3]) })
    }
    else if (arg === '--exclude') options.excludes.push(new RegExp(value))
    else if (arg === '--max-file-bytes') options.maxFileBytes = wholeNumber(arg, value)
    else if (arg === '--max-run-bytes') options.maxRunBytes = wholeNumber(arg, value)
    else if (arg === '--settle-seconds') options.settleMs = wholeNumber(arg, value) * 1000
    else throw new Error(`unknown argument ${arg}`)
  }
  if (options.sources.length === 0) options.sources = defaultSources(env)
  const names = options.sources.map(source => source.name)
  if (new Set(names).size !== names.length) throw new Error(`--source names must be distinct: ${names.join(', ')}`)
  return options
}

/**
 * Lists the files one source selects, in a stable order.
 * @param {{ name: string, policy: string, path: string }} source the source root
 * @param {RegExp[]} excludes absolute-path patterns to skip
 * @returns {string[]} absolute file paths
 */
function listSourceFiles(source, excludes) {
  const root = source.path
  const stat = statSync(root, { throwIfNoEntry: false })
  if (stat === undefined) return []
  if (stat.isFile()) return excludes.some(re => re.test(root)) ? [] : [root]
  const files = []
  const walk = (dir, depth) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      // A directory removed between listing and reading (a finished shift's scratch).
      if (error.code === 'ENOENT') return
      throw error
    }
    if (depth > 0 && entries.some(entry => entry.name === '.git')) return
    for (const entry of entries.sort((left, right) => (left.name < right.name ? -1 : 1))) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== '.git' && entry.name !== 'node_modules') walk(path, depth + 1)
        continue
      }
      let isFile = entry.isFile()
      if (entry.isSymbolicLink()) isFile = statSync(path, { throwIfNoEntry: false })?.isFile() ?? false
      if (!isFile || excludes.some(re => re.test(path))) continue
      const rel = relative(root, path)
      if (source.policy === 'logs' && !/\.(?:log|jsonl)$/.test(rel)) continue
      if (source.policy === 'sessions' && !/(?:^|\/)\.sessions\//.test(rel) && rel.split('/').length !== 2) continue
      files.push(path)
    }
  }
  walk(root, 0)
  return files
}

/**
 * Reads the SHA-256 digests every collected build accepted as a placeholder.
 * @param {string} transcriptsDir data/transcripts of this checkout
 * @returns {Set<string>} accepted digests
 */
function acceptedPlaceholders(transcriptsDir) {
  const accepted = new Set()
  if (!existsSync(transcriptsDir)) return accepted
  for (const build of readdirSync(transcriptsDir)) {
    const manifest = join(transcriptsDir, build, 'raw', 'manifest.json')
    if (!existsSync(manifest)) continue
    for (const digest of JSON.parse(readFileSync(manifest, 'utf8')).acceptedHits ?? []) accepted.add(digest)
  }
  return accepted
}

/**
 * Masks one chunk's credentials and e-mail addresses. The text is the chunk's bytes decoded as
 * latin1, so every byte maps to one character and an unmasked chunk re-encodes
 * to its exact source bytes.
 * @param {string} text chunk bytes as latin1
 * @param {{ plain: boolean, pemOpen: boolean, accepted: Set<string> }} context whether the file is plain text, whether its previous chunk ended inside a private-key block, and the accepted placeholder digests
 * @returns {{ text: string, counts: Record<string, number>, pemOpen: boolean }} masked text, masks per pattern, and whether this chunk ends inside a private-key block
 */
export function redactChunk(text, { plain, pemOpen, accepted }) {
  const counts = {}
  let masked = text
  let open = false
  if (plain) {
    const block = maskPlainPrivateKeys(text, pemOpen)
    masked = block.text
    open = block.open
    if (block.count > 0) counts['private-key'] = block.count
  }
  const redacted = redactText(masked, SECRET_PATTERN_NAMES, accepted)
  for (const [name, n] of Object.entries(redacted.counts)) counts[name] = (counts[name] ?? 0) + n
  return { text: redacted.text, counts, pemOpen: open }
}

// A PEM body line: base64, an RFC 1421 header (`Proc-Type: …`), or blank.
const PEM_BODY_LINE = /^(?:[A-Za-z0-9+/=]*|[A-Za-z-]+: .*)\r?$/

/**
 * Masks the PEM private-key blocks of plain text whose BEGIN and END sit on
 * different lines: the BEGIN line from its marker on becomes one marker, and
 * the body lines after it and the END marker are removed. A block still open
 * at the end of the text continues into the next chunk, whose leading body
 * lines and END marker are removed the same way. A block on one line is left
 * to redactText.
 * @param {string} text plain-text chunk
 * @param {boolean} pemOpen whether the previous chunk ended inside a block
 * @returns {{ text: string, open: boolean, count: number }} masked text, whether it ends inside a block, and how many blocks it masked
 */
function maskPlainPrivateKeys(text, pemOpen) {
  const marker = redactionMarker('private-key')
  const out = []
  let open = pemOpen
  let count = 0
  if (pemOpen) {
    out.push(`${marker}\n`)
    count++
  }
  for (const line of text.split(/(?<=\n)/)) {
    const newline = line.endsWith('\n') ? '\n' : ''
    const body = line.slice(0, line.length - newline.length)
    if (open) {
      const end = new RegExp(PRIVATE_KEY_END.source).exec(body)
      if (end !== null) {
        open = false
        const rest = body.slice(end.index + end[0].length)
        if (rest.trim() !== '') out.push(rest + newline)
        continue
      }
      if (PEM_BODY_LINE.test(body)) continue
      open = false
    }
    const lastBegin = [...body.matchAll(PRIVATE_KEY_MARKER_LINE)].at(-1)
    const lastEnd = [...body.matchAll(PRIVATE_KEY_END)].at(-1)
    if (lastBegin === undefined || (lastEnd !== undefined && lastEnd.index > lastBegin.index)) {
      out.push(line)
      continue
    }
    out.push(body.slice(0, lastBegin.index) + marker + newline)
    open = true
    count++
  }
  return { text: out.join(''), open, count }
}

/**
 * Chooses how many of a file's new bytes this run takes.
 * @param {Buffer} buffer the whole file
 * @param {number} start first uncaptured byte
 * @param {number} budget most bytes this run may take from the file
 * @param {boolean} settled whether the file is past the settle time
 * @returns {number} bytes to take from `start`; 0 when nothing is ready
 */
function chunkLength(buffer, start, budget, settled) {
  const pending = buffer.length - start
  const window = buffer.subarray(start, start + Math.min(pending, budget))
  const lastNewline = window.lastIndexOf(0x0a)
  if (pending <= budget) {
    if (lastNewline === window.length - 1 || settled) return window.length
    return lastNewline + 1
  }
  if (lastNewline >= 0) return lastNewline + 1
  // One line longer than the budget is taken whole once it ends.
  const next = buffer.indexOf(0x0a, start + window.length)
  if (next >= 0) return next + 1 - start
  return settled ? pending : 0
}

/**
 * Names a file's chunk directory: short enough for every checkout, readable,
 * and distinct per source path.
 * @param {string} source source name
 * @param {string} path absolute source path
 * @param {string} day first capture date
 * @returns {string} live-relative directory
 */
function fileDir(source, path, day) {
  const stem = `${basename(dirname(path))}_${basename(path)}`.replace(/[^A-Za-z0-9._-]/g, '-').slice(-48).replace(/^[^A-Za-z0-9]+/, '')
  return `${source}/${day}/${stem}-${sha256(`${source}\0${path}`).slice(0, 10)}`
}

/**
 * Runs one capture.
 * @param {string[]} argv arguments after the script path
 * @param {NodeJS.ProcessEnv} env process environment
 * @param {Date} now capture time
 * @returns {{ manifest: Record<string, any> | null, log: string[] }} the written manifest, or null when nothing was new, and the log lines
 */
export function capture(argv, env = process.env, now = new Date()) {
  const options = parseArgs(argv, env)
  const log = []
  const accepted = new Set([...acceptedPlaceholders(join(REPO_DIR, 'data', 'transcripts')), ...options.acceptedHits])
  const state = captureState(readRuns(options.live))
  const capturedAt = now.toISOString()
  const day = capturedAt.slice(0, 10)
  const chunks = []
  const deferred = []
  const absent = []
  const written = []
  let runBytes = 0
  try {
    for (const source of options.sources) {
      if (!existsSync(source.path)) { absent.push(source.path); continue }
      for (const path of listSourceFiles(source, options.excludes)) {
        const stat = statSync(path, { throwIfNoEntry: false })
        if (stat === undefined) continue
        const previous = state.get(path)
        if (previous !== undefined && stat.size === previous.bytes[1] && stat.mtimeMs <= Date.parse(previous.capturedAt)) continue
        const buffer = readFileSync(path)
        const hash = createHash('sha256')
        let epoch = 1
        let seq = 1
        let start = 0
        let line = 0
        let pemOpen = false
        let dir = fileDir(source.name, path, day)
        let reason = 'first capture'
        if (previous !== undefined) {
          dir = previous.file.split('/').slice(0, 3).join('/')
          const end = previous.bytes[1]
          if (buffer.length >= end) hash.update(buffer.subarray(0, end))
          if (buffer.length >= end && hash.copy().digest('hex') === previous.prefixSha256) {
            if (buffer.length === end) continue
            ;({ epoch } = previous)
            seq = previous.seq + 1
            start = end
            line = previous.lines[1]
            pemOpen = previous.pemOpen === true
            reason = undefined
          } else {
            epoch = previous.epoch + 1
            reason = `its first ${end} bytes no longer match epoch ${previous.epoch}`
            log.push(`new epoch ${epoch} for ${path}: ${reason}`)
          }
        }
        const prefixHash = start === 0 ? createHash('sha256') : hash
        const budget = Math.min(options.maxFileBytes, options.maxRunBytes - runBytes)
        const pending = buffer.length - start
        if (budget <= 0) {
          deferred.push({ path, pendingBytes: pending, reason: 'run ceiling' })
          log.push(`deferred ${path}: ${pending} new bytes, the run reached --max-run-bytes ${options.maxRunBytes}`)
          continue
        }
        const settled = now.getTime() - stat.mtimeMs >= options.settleMs
        const length = chunkLength(buffer, start, budget, settled)
        if (length === 0) {
          log.push(`waiting on ${path}: ${pending} bytes without a line end, changed within --settle-seconds`)
          continue
        }
        if (length < pending && pending > budget) {
          deferred.push({ path, pendingBytes: pending - length, reason: 'file ceiling' })
          log.push(`deferred ${path}: took ${length} of ${pending} new bytes (--max-file-bytes ${options.maxFileBytes}); the next run continues at byte ${start + length}`)
        }
        const raw = buffer.subarray(start, start + length)
        const plain = extname(path) !== '.jsonl'
        const redacted = redactChunk(raw.toString('latin1'), { plain, pemOpen, accepted })
        const survived = scanSecrets(path, redacted.text).filter(hit => !accepted.has(hit.digest))
        if (survived.length > 0) {
          throw new Error(`${path}: ${survived.length} credential- or e-mail-shaped match(es) survived redaction (${survived.map(hit => hit.pattern).join(', ')}); nothing from this run is kept`)
        }
        const stored = Buffer.from(redacted.text, 'latin1')
        const file = `${dir}/e${epoch}/${day}/${String(seq).padStart(6, '0')}${extname(path) || '.txt'}.gz`
        const target = join(options.live, file)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, gzipSync(stored, { level: 9 }), { flag: 'wx' })
        written.push(target)
        prefixHash.update(raw)
        let newlines = 0
        for (let at = raw.indexOf(0x0a); at >= 0; at = raw.indexOf(0x0a, at + 1)) newlines++
        chunks.push({
          source: source.name,
          path,
          file,
          epoch,
          seq,
          ...(reason === undefined ? {} : { epochStart: reason }),
          bytes: [start, start + length],
          lines: [line, line + newlines],
          sha256: sha256(stored),
          prefixSha256: prefixHash.digest('hex'),
          ...(Object.keys(redacted.counts).length === 0 ? {} : { redactions: redacted.counts }),
          ...(redacted.pemOpen ? { pemOpen: true } : {}),
          capturedAt,
        })
        runBytes += length
      }
    }
  } catch (error) {
    for (const target of written) rmSync(target, { force: true })
    throw error
  }
  if (absent.length > 0) log.push(`absent: ${absent.join(', ')}`)
  if (chunks.length === 0) {
    log.push('nothing new')
    return { manifest: null, log }
  }
  const redactions = {}
  for (const chunk of chunks) {
    for (const [name, n] of Object.entries(chunk.redactions ?? {})) redactions[name] = (redactions[name] ?? 0) + n
  }
  const manifest = {
    format: LIVE_FORMAT,
    capturedAt,
    acceptedHits: [...accepted].sort(),
    bytes: runBytes,
    redactions,
    ...(deferred.length === 0 ? {} : { deferred }),
    chunks,
  }
  const manifestPath = join(options.live, 'runs', day, `${capturedAt.replace(/:/g, '-')}.json`)
  mkdirSync(dirname(manifestPath), { recursive: true })
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
  const files = new Set(chunks.map(chunk => chunk.path)).size
  const masked = Object.entries(redactions).map(([name, n]) => `${name} ${n}`).join(', ') || 'none'
  log.push(`captured ${chunks.length} chunks from ${files} files (${(runBytes / MIB).toFixed(2)} MiB) into ${relative(process.cwd(), manifestPath)}; redacted: ${masked}`)
  return { manifest, log }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try {
    const { log } = capture(process.argv.slice(2))
    for (const line of log) console.log(`capture-live: ${line}`)
  } catch (error) {
    console.error(`capture-live: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
