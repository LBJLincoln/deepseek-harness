#!/usr/bin/env node
// Records one code-safety run under data/code-safety/<name>/: the driver's
// result line, the report it released, the union of findings, the examiner's
// verdict, every session log, and a manifest with the repository head, the
// composition, the locked target, the per-department outcome and every file's
// SHA-256. Node built-ins only.
//
// Usage: node record-run.mjs <run-directory> <name> --composition <path>
//
//   <run-directory>  where `pnpm run code-safety` ran: holds stdout.jsonl,
//                    stderr.txt, .sessions/ and repo/
//   <name>           the record directory name, e.g. 2026-09-19-nodegoat
//   --composition    repository-relative cordis.yml the driver booted
//
// The record directory is written once; an existing target is refused so a
// recorded run is never rewritten in place. A run whose program did not release
// is recorded exactly as it ended — what a failed run exposed is the reason to
// keep it.

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { REDACTION_RULE, redactRecordFiles } from './redact-record.mjs'

const REPO_DIR = resolve(import.meta.dirname, '..', '..', '..')
const RECORDS_DIR = resolve(import.meta.dirname, '..')

/** Severities a finding may claim, most severe first. */
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info']

/**
 * Parses the command line.
 * @param {string[]} argv arguments after the script path
 * @returns {{ runDirectory: string, name: string, composition: string }}
 */
function parseArgs(argv) {
  const positional = []
  let composition
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--composition') composition = argv[++i]
    else positional.push(argv[i])
  }
  const [runDirectory, name] = positional
  if (runDirectory === undefined || name === undefined || composition === undefined) {
    throw new Error('usage: node record-run.mjs <run-directory> <name> --composition <path>')
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error(`run name must be a plain directory name: ${name}`)
  return { runDirectory: resolve(runDirectory), name, composition }
}

/**
 * @param {Buffer | string} content bytes to digest
 * @returns {string} lowercase hex SHA-256
 */
function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

/** Credential shapes a record may never carry; redaction handles key material, these refuse the record outright. */
const CREDENTIAL_PATTERNS = [
  { name: 'openrouter-key', re: /\bsk-or-v1-[A-Za-z0-9]{20,}/ },
  { name: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/ },
  { name: 'github-fine-grained-token', re: /\bgithub_pat_[A-Za-z0-9_]{20,}/ },
  { name: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
]

/**
 * Refuses a record that carries a credential-shaped string after redaction.
 * @param {string} target the record directory
 * @param {string[]} relativePaths the record's files
 */
function refuseCredentials(target, relativePaths) {
  for (const path of relativePaths) {
    const text = readFileSync(join(target, path), 'utf8')
    for (const { name, re } of CREDENTIAL_PATTERNS) {
      if (re.test(text)) throw new Error(`${path} carries a ${name}; the record is refused — remove the credential from the run before recording it`)
    }
  }
}

/**
 * Digests the knowledge pack the departments read, so a record says which
 * skill text was in play even when the tree was dirty at record time.
 * @param {string} root the pack directory
 * @returns {{ root: string, files: number, sha256: string }}
 */
function knowledgeDigest(root) {
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.md')) files.push(path)
    }
  }
  walk(root)
  const hash = createHash('sha256')
  for (const path of files) hash.update(`${relative(root, path)}\0`).update(readFileSync(path)).update('\0')
  return { root: relative(REPO_DIR, root), files: files.length, sha256: hash.digest('hex') }
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
 * The wall clock the session logs span.
 * @param {{ sessionId: string, path: string }[]} logs every session log of the run
 * @returns {{ startedAt: number | undefined, endedAt: number | undefined }}
 */
function span(logs) {
  let startedAt
  let endedAt
  for (const { path } of logs) {
    for (const line of readFileSync(path, 'utf8').trim().split('\n')) {
      const event = JSON.parse(line)
      // The header line carries `createdAt`; every event line carries `time`.
      const at = typeof event.time === 'number' ? event.time : event.createdAt
      if (typeof at !== 'number') continue
      startedAt = startedAt === undefined ? at : Math.min(startedAt, at)
      endedAt = endedAt === undefined ? at : Math.max(endedAt, at)
    }
  }
  return { startedAt, endedAt }
}

function main() {
  const { runDirectory, name, composition } = parseArgs(process.argv.slice(2))
  const target = join(RECORDS_DIR, name)
  if (existsSync(target)) throw new Error(`${relative(REPO_DIR, target)} already exists; a recorded run is never rewritten`)
  if (!existsSync(join(REPO_DIR, composition))) throw new Error(`composition ${composition} is not in the repository`)

  const stdout = join(runDirectory, 'stdout.jsonl')
  if (!existsSync(stdout)) throw new Error(`${runDirectory} holds no stdout.jsonl; the driver wrote no result`)
  const result = JSON.parse(readFileSync(stdout, 'utf8').trim().split('\n').at(-1))
  if (result.type !== 'result') throw new Error(`${stdout} does not end in a result line`)

  const logs = sessionLogs(runDirectory)
  const { startedAt, endedAt } = span(logs)
  mkdirSync(join(target, 'sessions'), { recursive: true })

  const written = []
  const record = (relativePath, content) => {
    writeFileSync(join(target, relativePath), content)
    written.push(relativePath)
  }
  record('result.json', Buffer.from(`${JSON.stringify(result, null, 2)}\n`))
  if (result.safetyReport !== '') record('SAFETY-REPORT.md', Buffer.from(result.safetyReport))
  if (result.findings !== '') record('findings.json', Buffer.from(result.findings))
  record('verifier.txt', Buffer.from(`exit ${result.verifier.exitCode}\n${result.verifier.output}`))
  const stderr = join(runDirectory, 'stderr.txt')
  if (existsSync(stderr) && statSync(stderr).size > 0) record('stderr.txt', readFileSync(stderr))
  for (const { sessionId, path } of logs) record(`sessions/${sessionId}.jsonl`, readFileSync(path))
  // Key material the departments read out of the target is replaced before anything is digested.
  const redactions = redactRecordFiles(target, written)
  refuseCredentials(target, written)
  const files = written.map((path) => {
    const content = readFileSync(join(target, path))
    return { path, bytes: content.length, sha256: sha256(content) }
  })

  const findings = result.findings === '' ? [] : JSON.parse(result.findings)
  const git = (args) => execFileSync('git', ['-C', REPO_DIR, ...args], { encoding: 'utf8' }).trim()
  const manifest = {
    run: name,
    ranAt: startedAt === undefined ? undefined : new Date(startedAt).toISOString(),
    endedAt: endedAt === undefined ? undefined : new Date(endedAt).toISOString(),
    elapsedSeconds: result.elapsedSeconds,
    repository: {
      branch: git(['branch', '--show-current']),
      head: git(['rev-parse', 'HEAD']),
      // A record made from a dirty tree names the paths that differed from its head.
      changedPaths: execFileSync('git', ['-C', REPO_DIR, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' })
        .split('\n')
        .filter(Boolean)
        .map(line => line.replace(/^.{2} /, '')),
    },
    composition,
    knowledge: knowledgeDigest(process.env.DSH_CODE_SAFETY_SKILLS ?? join(REPO_DIR, 'data', 'knowledge', 'code-safety')),
    programId: result.report.programId,
    outcome: result.report.outcome,
    mergedRevision: result.report.mergedRevision,
    target: result.target,
    departments: result.report.goals.map(goal => ({ key: goal.key, status: goal.status, revision: goal.revision, tree: goal.tree })),
    certified: result.members.filter(member => member.certified).map(member => member.key).sort(),
    findings: {
      total: findings.length,
      bySeverity: Object.fromEntries(SEVERITIES.map(severity => [severity, findings.filter(finding => finding.severity === severity).length])),
      byConfidence: Object.fromEntries(['confirmed', 'likely', 'possible'].map(confidence => [confidence, findings.filter(finding => finding.confidence === confidence).length])),
    },
    verifier: { exitCode: result.verifier.exitCode },
    denials: result.denials.length,
    sessions: Object.fromEntries(logs.map(log => [log.sessionId, `sessions/${log.sessionId}.jsonl`])),
    files,
    redactions: { rule: REDACTION_RULE, tool: 'tools/redact-record.mjs', files: redactions },
  }
  writeFileSync(join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`recorded ${relative(REPO_DIR, target)}: ${files.length} files, ${logs.length} session logs, ${findings.length} findings, outcome ${result.report.outcome}, examiner exit ${result.verifier.exitCode}, ${redactions.length} files redacted`)
}

main()
