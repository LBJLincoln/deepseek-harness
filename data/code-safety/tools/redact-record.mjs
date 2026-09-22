#!/usr/bin/env node
// Replaces key material the departments read out of a target inside a recorded
// review, in place, before the record is committed: every private-key body
// between its `-----BEGIN … PRIVATE KEY-----` and `-----END … PRIVATE KEY-----`
// lines becomes `[REDACTED PRIVATE KEY BODY]` (the markers and the cited line
// the examiner verified stay), and the AWS documentation example access key
// becomes `[REDACTED-EXAMPLE-KEY]`. Certificates and public keys are left as
// they are. The escaping the surrounding file uses (a raw newline, a JSON `\n`,
// or a doubly encoded `\\n`) is kept, so JSON and JSONL files stay parseable.
// Two shapes hold a body outside one BEGIN…END string: a file-read tool's
// `lines` meta, where every key line is its own JSON string, and a key a tool
// cut off before its END line. Both are walked line by line after the BEGIN
// marker; a base64-only line is body and is replaced, the walk stops at the
// END marker or at the first line that is anything else.
//
// Idempotent: a redacted file has nothing left to replace. `record-run.mjs`
// calls `redactRecordFiles` before it digests a new record; run this tool by
// hand on a record that predates it, which rewrites the files, updates their
// digests in `manifest.json`, and adds the `redactions` block the README names.
//
// Usage: node redact-record.mjs <record dir> [--dry-run]
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The rule sentence every redacted record carries in its manifest. */
export const REDACTION_RULE = 'Private key material and example cloud keys the departments read out of the target were replaced before the record was committed; the cited lines the examiner verified are untouched.'

// The body may not cross a JSON string boundary (an unescaped `"`) or another
// PEM marker, so a BEGIN line quoted on its own, as a search hit is, matches nothing.
const PRIVATE_KEY_BLOCK = /-----BEGIN ((?:[A-Z]+ )*PRIVATE KEY)-----((?:(?!-----)[^"])*?)-----END \1-----/g
const EXAMPLE_AWS_KEY = /AKIAIOSFODNN7EXAMPLE/g
const PRIVATE_KEY_MARKER = '[REDACTED PRIVATE KEY BODY]'
const EXAMPLE_KEY_MARKER = '[REDACTED-EXAMPLE-KEY]'

// The block rule cannot reach a key whose lines are separate JSON strings (a
// file-read tool's `lines` meta holds one entry per line) or a key a tool cut
// off before its END line. The line walk below covers both: after a BEGIN
// marker it consumes one line at a time through whichever separator the file
// uses and replaces body lines until the END marker or any other text.
const PRIVATE_KEY_HEADER = /-----BEGIN ((?:[A-Z]+ )*PRIVATE KEY)-----/g
const LINES_ENTRY_SEPARATOR = /^"\},\{"number":\d+,"text":"/
// A tool that marks line ends (`cat -e`) puts a `$` before the newline.
const ESCAPED_NEWLINE = /^\$?(\\+)(?:r\\+)?n/
const RAW_NEWLINE = /^\$?\r?\n/
const ESCAPED_NEWLINE_ANYWHERE = /(\\+)(?:r\\+)?n/
// A PEM body line: base64 only, at most 76 columns, ended by the next separator.
const BODY_LINE = /^[A-Za-z0-9+/=]{1,76}(?=\$?["\\\r\n])/
// A line an earlier redaction already replaced; the walk steps over it.
const REDACTED_LINE = /^\[REDACTED (?:PRIVATE KEY BODY|KEY MATERIAL)\](?=\$?["\\\r\n])/
const LOOKAHEAD = 4096

/**
 * Replace private-key body lines the block rule left: the `lines`-meta shape and
 * a key cut off before its END line. A flat body collapses into one marker line;
 * a `lines` entry keeps one marker per entry so the JSON stays intact.
 * @param {string} text - The file's content after the block rule ran.
 * @returns {{ text: string, bodies: number }} The rewritten text and how many key bodies were replaced.
 */
function redactKeyLines(text) {
  let bodies = 0
  let out = ''
  let last = 0
  for (const header of text.matchAll(PRIVATE_KEY_HEADER)) {
    const start = header.index + header[0].length
    if (start < last) continue
    let cursor = start
    let segment = ''
    let replaced = false
    for (;;) {
      const ahead = text.slice(cursor, cursor + LOOKAHEAD)
      const entry = LINES_ENTRY_SEPARATOR.exec(ahead)
      const separator = entry ?? ESCAPED_NEWLINE.exec(ahead) ?? RAW_NEWLINE.exec(ahead)
      if (separator === null) break
      const lineStart = cursor + separator[0].length
      const line = text.slice(lineStart, lineStart + LOOKAHEAD)
      if (line.startsWith('-----END ')) break
      const marker = REDACTED_LINE.exec(line)
      if (marker !== null) {
        segment += separator[0] + marker[0]
        cursor = lineStart + marker[0].length
        continue
      }
      const body = BODY_LINE.exec(line)
      if (body === null) break
      if (entry !== null || !replaced) segment += separator[0] + PRIVATE_KEY_MARKER
      replaced = true
      cursor = lineStart + body[0].length
    }
    if (!replaced) continue
    bodies += 1
    out += text.slice(last, start) + segment
    last = cursor
  }
  return { text: out + text.slice(last), bodies }
}

/**
 * Redact one file's text.
 * @param {string} text - The file's content.
 * @returns {{ text: string, privateKeyBodies: number, exampleAwsKeys: number }} The redacted text and how many replacements each rule made.
 */
export function redactText(text) {
  let privateKeyBodies = 0
  let exampleAwsKeys = 0
  const blocks = text
    .replace(PRIVATE_KEY_BLOCK, (match, kind, body) => {
      if (body.includes(PRIVATE_KEY_MARKER)) return match
      privateKeyBodies += 1
      // A JSON-encoded newline carries one backslash per encoding level doubled
      // (`\n`, `\\n`, `\\\\n`, …); the marker is joined with the same escape so the
      // file stays parseable at every depth. Raw text keeps a raw newline. The
      // first newline of either kind in the body decides, wherever it sits: a
      // raw newline written into a JSON string would break the file.
      const escaped = ESCAPED_NEWLINE_ANYWHERE.exec(body)
      const raw = body.indexOf('\n')
      const separator = escaped !== null && (raw < 0 || escaped.index < raw) ? `${escaped[1]}n` : raw >= 0 ? '\n' : ''
      return `-----BEGIN ${kind}-----${separator}${PRIVATE_KEY_MARKER}${separator}-----END ${kind}-----`
    })
  const lines = redactKeyLines(blocks)
  privateKeyBodies += lines.bodies
  const redacted = lines.text.replace(EXAMPLE_AWS_KEY, () => {
    exampleAwsKeys += 1
    return EXAMPLE_KEY_MARKER
  })
  return { text: redacted, privateKeyBodies, exampleAwsKeys }
}

/**
 * Redact every text file of a record in place.
 * @param {string} recordDir - The record directory.
 * @param {string[]} relativePaths - The record's files, relative to `recordDir`.
 * @param {{ dryRun?: boolean }} [options] - `dryRun` reports without writing.
 * @returns {Array<{ file: string, privateKeyBodies: number, exampleAwsKeys: number }>} One entry per file that had something to replace.
 */
export function redactRecordFiles(recordDir, relativePaths, options = {}) {
  const touched = []
  for (const file of relativePaths) {
    const path = join(recordDir, file)
    const before = readFileSync(path, 'utf8')
    const { text, privateKeyBodies, exampleAwsKeys } = redactText(before)
    if (privateKeyBodies === 0 && exampleAwsKeys === 0) continue
    if (options.dryRun !== true) writeFileSync(path, text)
    touched.push({ file, privateKeyBodies, exampleAwsKeys })
  }
  return touched
}

/**
 * Redact a recorded review that predates the recorder's own redaction step and
 * bring its manifest up to date: file digests and sizes, and the `redactions` block.
 * @param {string} recordDir - The record directory holding `manifest.json`.
 * @param {{ dryRun?: boolean }} [options] - `dryRun` reports without writing.
 * @returns {Array<{ file: string, privateKeyBodies: number, exampleAwsKeys: number }>} The files that were redacted.
 */
export function redactRecord(recordDir, options = {}) {
  const manifestPath = join(recordDir, 'manifest.json')
  if (!existsSync(manifestPath)) throw new Error(`${recordDir} holds no manifest.json`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const touched = redactRecordFiles(recordDir, manifest.files.map(entry => entry.path), options)
  if (options.dryRun === true) return touched
  // Every digest is recomputed, so a manifest whose digests drifted from its files is repaired too.
  let refreshed = 0
  for (const entry of manifest.files) {
    const content = readFileSync(join(recordDir, entry.path))
    const sha256 = createHash('sha256').update(content).digest('hex')
    if (entry.sha256 === sha256 && entry.bytes === content.length) continue
    entry.bytes = content.length
    entry.sha256 = sha256
    refreshed += 1
  }
  if (touched.length === 0 && refreshed === 0) return touched
  if (touched.length > 0) {
    // A file redacted on two occasions keeps one entry with the summed counts.
    const files = new Map((manifest.redactions?.files ?? []).map(entry => [entry.file, { ...entry }]))
    for (const entry of touched) {
      const previous = files.get(entry.file)
      if (previous === undefined) files.set(entry.file, { ...entry })
      else {
        previous.privateKeyBodies += entry.privateKeyBodies
        previous.exampleAwsKeys += entry.exampleAwsKeys
      }
    }
    manifest.redactions = {
      rule: REDACTION_RULE,
      tool: 'tools/redact-record.mjs',
      files: [...files.values()],
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  if (refreshed > 0) console.log(`${recordDir}: ${refreshed} file digests refreshed in manifest.json`)
  return touched
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [recordDir, ...flags] = process.argv.slice(2)
  if (recordDir === undefined) {
    console.error('usage: node redact-record.mjs <record dir> [--dry-run]')
    process.exit(2)
  }
  const dryRun = flags.includes('--dry-run')
  const touched = redactRecord(recordDir, { dryRun })
  for (const { file, privateKeyBodies, exampleAwsKeys } of touched) {
    console.log(`${dryRun ? 'would redact' : 'redacted'} ${file}: ${privateKeyBodies} private key bodies, ${exampleAwsKeys} example keys`)
  }
  if (touched.length === 0) console.log(`${recordDir}: nothing to redact`)
}
