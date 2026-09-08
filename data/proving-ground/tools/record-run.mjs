#!/usr/bin/env node
// Records one Proving Ground run under data/proving-ground/<name>/: copies the
// driver's exports and every cell and shift session log out of the directory
// the driver ran in, and writes a manifest with the repository head, the
// composition, the implementer, the session ids, and every file's SHA-256.
// Node built-ins only.
//
// Usage: node record-run.mjs <run-directory> <name> --composition <path> [--elapsed-seconds <n>]
//
//   <run-directory>   where the driver ran: holds facts.jsonl, trajectories.jsonl,
//                     observatory.json, observatory.html, .sessions/, and either
//                     stdout.jsonl (a fleet driver's result line) or status.json
//                     (a shift driver's status)
//   <name>            the run directory name, e.g. 2026-09-06-claude-code-run-2
//   --composition     repository-relative cordis.yml the driver booted
//   --elapsed-seconds wall time of the run when the driver did not record it
//
// The run directory is written once; an existing target is refused so a
// recorded run is never rewritten in place. Recording prints the escape census
// of the new record (`census-escapes.mjs`), so what each cell reached outside
// its own workspace is read at the moment the run enters the corpus.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { censusRecord, formatCensus } from './census-escapes.mjs'

const REPO_DIR = resolve(import.meta.dirname, '..', '..', '..')
const RUNS_DIR = resolve(import.meta.dirname, '..')
const EXPORTS = ['facts.jsonl', 'trajectories.jsonl', 'observatory.json', 'observatory.html']

/**
 * Parses the command line.
 * @param {string[]} argv arguments after the script path
 * @returns {{ runDirectory: string, name: string, composition: string, elapsedSeconds: number | undefined }}
 */
function parseArgs(argv) {
  const positional = []
  const options = { composition: undefined, elapsedSeconds: undefined }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--composition') { options.composition = argv[++i] }
    else if (arg === '--elapsed-seconds') { options.elapsedSeconds = Number(argv[++i]) }
    else positional.push(arg)
  }
  const [runDirectory, name] = positional
  if (runDirectory === undefined || name === undefined || options.composition === undefined) {
    throw new Error('usage: node record-run.mjs <run-directory> <name> --composition <path> [--elapsed-seconds <n>]')
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error(`run name must be a plain directory name: ${name}`)
  return { runDirectory: resolve(runDirectory), name, ...options }
}

/**
 * @param {Buffer | string} content bytes to digest
 * @returns {string} lowercase hex SHA-256
 */
function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Finds every session log the driver's persistence root holds.
 * @param {string} runDirectory where the driver ran
 * @returns {{ sessionId: string, path: string }[]}
 */
function sessionLogs(runDirectory) {
  const root = join(runDirectory, '.sessions')
  if (!existsSync(root)) return []
  const logs = []
  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name === 'session.jsonl') logs.push({ sessionId: relative(root, directory).split('/').at(-1), path })
    }
  }
  walk(root)
  return logs.sort((a, b) => a.sessionId.localeCompare(b.sessionId))
}

/**
 * Reads the driver's result: a fleet driver's last stdout line or a shift driver's status file.
 * @param {string} runDirectory where the driver ran
 * @returns {{ kind: 'result' | 'status', value: Record<string, unknown> }}
 */
function driverResult(runDirectory) {
  const stdout = join(runDirectory, 'stdout.jsonl')
  if (existsSync(stdout)) {
    const lines = readFileSync(stdout, 'utf8').trim().split('\n')
    const last = JSON.parse(lines.at(-1))
    if (last.type === 'result') return { kind: 'result', value: last }
  }
  const status = join(runDirectory, 'status.json')
  if (existsSync(status)) return { kind: 'status', value: JSON.parse(readFileSync(status, 'utf8')) }
  throw new Error(`${runDirectory} holds neither a result line in stdout.jsonl nor a status.json`)
}

/**
 * Folds the run stamps out of the session logs: environment ids per session, the implementer, the district, and the isolation.
 * @param {{ sessionId: string, path: string }[]} logs every session log of the run
 * @returns {{ sessions: Record<string, string>, implementers: string[], districts: string[], isolations: string[], startedAt: number | undefined, endedAt: number | undefined }}
 */
function foldStamps(logs) {
  const sessions = {}
  const implementers = new Set()
  const districts = new Set()
  const isolations = new Set()
  let startedAt
  let endedAt
  for (const { sessionId, path } of logs) {
    for (const line of readFileSync(path, 'utf8').trim().split('\n')) {
      const event = JSON.parse(line)
      // The header line carries `createdAt`; every event line carries `time`.
      const at = typeof event.time === 'number' ? event.time : event.createdAt
      if (typeof at === 'number') {
        startedAt = startedAt === undefined ? at : Math.min(startedAt, at)
        endedAt = endedAt === undefined ? at : Math.max(endedAt, at)
      }
      if (event.type !== 'environment/run') continue
      sessions[event.data.environmentId] = sessionId
      if (event.data.implementer !== undefined) implementers.add(event.data.implementer)
      if (event.data.district !== undefined) districts.add(event.data.district)
      if (event.data.isolation !== undefined) isolations.add(event.data.isolation)
    }
  }
  return { sessions, implementers: [...implementers].sort(), districts: [...districts].sort(), isolations: [...isolations].sort(), startedAt, endedAt }
}

function main() {
  const { runDirectory, name, composition, elapsedSeconds } = parseArgs(process.argv.slice(2))
  const target = join(RUNS_DIR, name)
  if (existsSync(target)) throw new Error(`${relative(REPO_DIR, target)} already exists; a recorded run is never rewritten`)
  if (!existsSync(join(REPO_DIR, composition))) throw new Error(`composition ${composition} is not in the repository`)

  const result = driverResult(runDirectory)
  const logs = sessionLogs(runDirectory)
  const stamps = foldStamps(logs)
  mkdirSync(join(target, 'sessions'), { recursive: true })

  const files = []
  const record = (relativePath, content) => {
    const path = join(target, relativePath)
    writeFileSync(path, content)
    files.push({ path: relativePath, bytes: content.length, sha256: sha256(content) })
  }
  record('result.json', Buffer.from(`${JSON.stringify(result.value, null, 2)}\n`))
  for (const exportName of EXPORTS) {
    const source = join(runDirectory, exportName)
    if (existsSync(source)) record(exportName, readFileSync(source))
  }
  for (const { sessionId, path } of logs) record(`sessions/${sessionId}.jsonl`, readFileSync(path))

  const git = (args) => execFileSync('git', ['-C', REPO_DIR, ...args], { encoding: 'utf8' }).trim()
  const manifest = {
    run: name,
    ranAt: stamps.startedAt === undefined ? undefined : new Date(stamps.startedAt).toISOString(),
    endedAt: stamps.endedAt === undefined ? undefined : new Date(stamps.endedAt).toISOString(),
    elapsedSeconds: elapsedSeconds ?? (stamps.startedAt === undefined || stamps.endedAt === undefined ? undefined : Math.round((stamps.endedAt - stamps.startedAt) / 1000)),
    repository: { branch: git(['branch', '--show-current']), head: git(['rev-parse', 'HEAD']) },
    composition,
    driverResult: result.kind,
    districts: stamps.districts,
    implementers: stamps.implementers,
    isolations: stamps.isolations,
    sessions: stamps.sessions,
    files,
  }
  writeFileSync(join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`recorded ${relative(REPO_DIR, target)}: ${files.length} files, ${logs.length} session logs, implementers ${stamps.implementers.join(', ') || 'none'}`)
  // The census reads the run as recorded, so what it prints is what any later
  // reader of this directory gets from `census-escapes.mjs`.
  console.log(formatCensus(censusRecord(target)))
}

main()
