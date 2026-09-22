#!/usr/bin/env node
// Re-exports one recorded Proving Ground run: re-folds every session log the
// record keeps under sessions/ with the current `@deepseek-ai/dsh-trajectories`
// fold and rewrites trajectories.jsonl, so a record exported by an older build
// carries the projection today's readers expect.
//
// Usage: node reexport-trajectories.mjs <record-directory> [--check]
//
//   <record-directory>  a directory under data/proving-ground/ holding
//                       sessions/ and a trajectories.jsonl to replace
//   --check             re-fold in memory and report whether the committed
//                       trajectories.jsonl is what this tool would write;
//                       exit 1 on drift, write nothing
//
// The fold is the one the exporter runs: this tool reads each session log with
// the JSONL backend's own `scanLog` — the decoder `JsonlSessionPersistence`
// uses, which expands the packed chunk rows a log actually holds — and passes
// the header and events to `foldTrajectory`. It reproduces
// `ctx.trajectories.export({ sink })` with no further options, the request
// every uncurated record under data/proving-ground/ was exported with: a
// session whose stamp is held out is withheld, and no district filter applies
// because the bench composition configures none.
//
// It applies no redaction, so it re-exports only an uncurated record. A record
// whose lines carry a `curation` block was written by `ctx.curator.export()`,
// and re-folding its session logs here would drop that block and put back
// every string the profile replaced, so the tool refuses such a record in both
// modes. Redacting here instead would write a record no run ever produced.
//
// What it may change: trajectories.jsonl, and in manifest.json that file's
// bytes and SHA-256 plus one appended `reexports` entry. What it never changes:
// result.json, facts.jsonl, observatory.json, observatory.html, sessions/, and
// every earlier `reexports` entry. It refuses to run at all when the record
// holds no sessions/, when it holds no trajectories.jsonl to re-export, when
// that export is curated, when a session the previous export named is missing,
// and when the re-fold would drop or add a trajectory: the set of session ids
// must be identical, because the point is a newer projection of the same
// sessions and never a different corpus.
//
// Lines keep the previous export's order, matched by session id, so a re-export
// changes what each line says and never where it sits.
//
// The fold is TypeScript source and the JSONL backend's `scanLog` is not in any
// built `lib/`, so this tool runs under tsx like the bench drivers do. It
// re-executes itself once with tsx's ESM loader when that loader is not already
// registered, which is why the package imports below are dynamic: a static
// import would be resolved before the re-execution could happen.

import { spawnSync, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_DIR = resolve(import.meta.dirname, '..', '..', '..')
const TOOL_PATH = relative(REPO_DIR, fileURLToPath(import.meta.url))
/** tsx's ESM loader, the launcher every source-plane Proving Ground driver runs under. */
const TSX_LOADER = pathToFileURL(join(REPO_DIR, 'node_modules/tsx/dist/esm/index.mjs')).href
/** Bumped when a `reexports` entry gains or changes a field. */
const TOOL_VERSION = 1
const SESSION_LOG_SUFFIX = '.jsonl'

/**
 * Re-execute this tool under tsx when its loader is not registered, so the
 * dynamic imports below reach the TypeScript sources.
 * @returns {never | undefined} exits with the child's status, or returns when the loader is already active
 */
function relaunchUnderTsx() {
  if (process.execArgv.includes(TSX_LOADER)) return undefined
  if (!existsSync(fileURLToPath(TSX_LOADER))) {
    throw new Error(`tsx is not installed at ${relative(REPO_DIR, fileURLToPath(TSX_LOADER))}; run pnpm install`)
  }
  const child = spawnSync(
    process.execPath,
    ['--import', TSX_LOADER, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, TSX_TSCONFIG_PATH: join(REPO_DIR, 'tsconfig.json') } },
  )
  if (child.error !== undefined) throw child.error
  process.exit(child.status ?? 1)
}

/**
 * @param {Buffer | string} content bytes to digest
 * @returns {string} lowercase hex SHA-256
 */
function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Parses the command line.
 * @param {string[]} argv arguments after the script path
 * @returns {{ record: string, check: boolean }}
 */
function parseArgs(argv) {
  let record
  let check = false
  for (const arg of argv) {
    if (arg === '--check') check = true
    else if (arg.startsWith('--')) throw new Error(`unknown argument ${arg}`)
    else if (record === undefined) record = arg
    else throw new Error(`unexpected argument ${arg}`)
  }
  if (record === undefined) throw new Error('usage: node reexport-trajectories.mjs <record-directory> [--check]')
  return { record: resolve(record), check }
}

/**
 * The session logs a record keeps, in name order.
 * @param {string} directory the record directory
 * @returns {{ sessionId: string, path: string }[]}
 */
function sessionLogs(directory) {
  const root = join(directory, 'sessions')
  return readdirSync(root)
    .filter(name => name.endsWith(SESSION_LOG_SUFFIX) && statSync(join(root, name)).isFile())
    .sort()
    .map(name => ({ sessionId: name.slice(0, -SESSION_LOG_SUFFIX.length), path: join(root, name) }))
}

/**
 * The previous export's lines, parsed, in file order.
 * @param {string} path the record's trajectories.jsonl
 * @returns {{ bytes: Buffer, records: object[] }} the file as committed and its parsed lines
 */
function readPreviousExport(path) {
  const bytes = readFileSync(path)
  const records = bytes.toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  return { bytes, records }
}

/**
 * Re-folds every session log with the current fold and keeps the ones the
 * exporter would write.
 * @param {{ sessionId: string, path: string }[]} logs the record's session logs
 * @param {(buffer: Buffer) => { meta: object, events: object[] }} scanLog the JSONL backend's log decoder
 * @param {(meta: object, events: object[]) => object} foldTrajectory the current fold
 * @returns {{ admitted: Map<string, object>, heldOut: string[] }} trajectories by session id, and the sessions the held-out rule withheld
 */
function refold(logs, scanLog, foldTrajectory) {
  const admitted = new Map()
  const heldOut = []
  for (const { sessionId, path } of logs) {
    const { meta, events } = scanLog(readFileSync(path))
    const trajectory = foldTrajectory(meta, events)
    if (trajectory.environment?.heldOut === true) {
      heldOut.push(sessionId)
      continue
    }
    admitted.set(trajectory.id, trajectory)
  }
  return { admitted, heldOut }
}

/**
 * Refuses every difference between the re-fold and the previous export that
 * would make this a different corpus rather than a newer projection.
 * @param {object[]} previous the previous export's parsed lines
 * @param {Map<string, object>} admitted the re-fold's trajectories by session id
 * @param {Set<string>} logged the session ids the record keeps a log for
 * @returns {string[]} one line per refusal, empty when the two name the same sessions
 */
function refusals(previous, admitted, logged) {
  const found = []
  const exported = previous.map(record => record.id)
  const missingLogs = exported.filter(id => !logged.has(id))
  if (missingLogs.length > 0) found.push(`the previous export names ${missingLogs.length} session(s) the record keeps no log for: ${missingLogs.join(', ')}`)
  const dropped = exported.filter(id => !admitted.has(id))
  const added = [...admitted.keys()].filter(id => !exported.includes(id))
  if (dropped.length > 0) found.push(`the re-fold drops ${dropped.length} trajectory(ies) the previous export carried: ${dropped.join(', ')}`)
  if (added.length > 0) found.push(`the re-fold adds ${added.length} trajectory(ies) the previous export did not carry: ${added.join(', ')}`)
  return found
}

/**
 * What a re-export changed, for the console and for `--check`.
 * @param {object[]} before the previous export's parsed lines
 * @param {object[]} after the re-folded lines in the same order
 * @param {Buffer | string} beforeBytes the committed file
 * @param {string} afterBytes the file this tool would write
 * @returns {{ lines: string[], changed: boolean }} the report and whether anything differs
 */
function describeChange(before, after, beforeBytes, afterBytes) {
  const formats = records => [...new Set(records.map(record => record.format))].sort().join(', ') || '(none)'
  const withTerms = records => records.filter(record => record.terms !== undefined).length
  const withStop = records => records.filter(record => record.stopReason !== undefined).length
  const beforeSha = sha256(beforeBytes)
  const afterSha = sha256(afterBytes)
  return {
    changed: beforeSha !== afterSha,
    lines: [
      `  format: ${formats(before)} -> ${formats(after)}`,
      `  terms:  ${withTerms(before)} of ${before.length} -> ${withTerms(after)} of ${after.length}`,
      `  stop:   ${withStop(before)} of ${before.length} -> ${withStop(after)} of ${after.length}`,
      `  lines:  ${before.length} -> ${after.length}`,
      `  sha256: ${beforeSha} -> ${afterSha}`,
    ],
  }
}

/**
 * Rewrites the manifest's entry for trajectories.jsonl and appends one
 * `reexports` entry, leaving every other field and every earlier entry alone.
 * @param {object} manifest the record's parsed manifest
 * @param {{ before: Buffer, after: string, beforeLines: number, afterLines: number, format: string }} change what was rewritten
 */
function recordReexport(manifest, change) {
  const entry = manifest.files.find(file => file.path === 'trajectories.jsonl')
  if (entry === undefined) throw new Error('manifest.json lists no trajectories.jsonl among its files')
  entry.bytes = Buffer.byteLength(change.after, 'utf8')
  entry.sha256 = sha256(change.after)
  manifest.reexports = [...manifest.reexports ?? [], {
    at: new Date().toISOString(),
    tool: TOOL_PATH,
    toolVersion: TOOL_VERSION,
    head: execFileSync('git', ['-C', REPO_DIR, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    format: change.format,
    before: { sha256: sha256(change.before), lines: change.beforeLines },
    after: { sha256: entry.sha256, lines: change.afterLines },
  }]
}

async function main() {
  relaunchUnderTsx()
  const { record, check } = parseArgs(process.argv.slice(2))
  const shown = relative(REPO_DIR, record)
  if (!existsSync(join(record, 'sessions'))) throw new Error(`${shown} holds no sessions/, so there is nothing to re-fold`)
  const exportPath = join(record, 'trajectories.jsonl')
  if (!existsSync(exportPath)) throw new Error(`${shown} holds no trajectories.jsonl; a re-export replaces an export, it does not create one`)
  const manifestPath = join(record, 'manifest.json')
  if (!existsSync(manifestPath)) throw new Error(`${shown} holds no manifest.json`)

  const { scanLog } = await import('../../../packages/session/session-persistence-jsonl/src/format.ts')
  const { foldTrajectory, TRAJECTORY_FORMAT } = await import('@deepseek-ai/dsh-trajectories')

  const logs = sessionLogs(record)
  const previous = readPreviousExport(exportPath)
  const curated = previous.records.filter(line => line.curation !== undefined).length
  if (curated > 0) {
    console.error(`refusing to re-export ${shown}: ${curated} of ${previous.records.length} line(s) carry a curation block`)
    console.error('  this tool re-folds with the unredacted exporter, which would drop the redaction a curated export applied')
    process.exit(1)
  }
  const { admitted, heldOut } = refold(logs, scanLog, foldTrajectory)
  const refused = refusals(previous.records, admitted, new Set(logs.map(log => log.sessionId)))
  if (refused.length > 0) {
    console.error(`refusing to re-export ${shown}: a re-export is a newer projection of the same sessions`)
    for (const line of refused) console.error(`  ${line}`)
    process.exit(1)
  }

  const refolded = previous.records.map(line => admitted.get(line.id))
  const content = refolded.map(trajectory => `${JSON.stringify(trajectory)}\n`).join('')
  const change = describeChange(previous.records, refolded, previous.bytes, content)

  if (check) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const entry = manifest.files.find(file => file.path === 'trajectories.jsonl')
    const manifestDrift = entry !== undefined && entry.sha256 !== sha256(previous.bytes)
    if (!change.changed && !manifestDrift) {
      console.log(`${shown}: trajectories.jsonl is what this tool would write (${refolded.length} line(s), ${TRAJECTORY_FORMAT})`)
      return
    }
    console.error(`${shown}: trajectories.jsonl has drifted from the current fold`)
    for (const line of change.lines) console.error(line)
    if (manifestDrift) console.error(`  manifest: records ${entry.sha256} for a file that digests ${sha256(previous.bytes)}`)
    console.error(`  re-export it: node ${TOOL_PATH} ${shown}`)
    process.exit(1)
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  recordReexport(manifest, {
    before: previous.bytes,
    after: content,
    beforeLines: previous.records.length,
    afterLines: refolded.length,
    format: TRAJECTORY_FORMAT,
  })
  writeFileSync(exportPath, content)
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`re-exported ${shown}: ${refolded.length} of ${logs.length} session log(s)${heldOut.length === 0 ? '' : `, ${heldOut.length} withheld as held out`}`)
  for (const line of change.lines) console.log(line)
  console.log(`  manifest: reexports[${manifest.reexports.length - 1}] at ${manifest.reexports.at(-1).at}, head ${manifest.reexports.at(-1).head}`)
}

await main()
