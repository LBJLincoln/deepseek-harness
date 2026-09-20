#!/usr/bin/env node
// Runs the nightly Routine's preflight and leaves one line of evidence per run:
// the install, the build, the Claude Code CLI and its login, and the queue's
// dry run, in that order, stopping at the first step that fails or runs past
// its timeout. Every run appends one JSON line to
// data/proving-ground/loop/preflight.jsonl — passed or stopped, with each
// step's exit status and seconds and the stopping step's last output — so a
// night that never reached the loop is still on file once the line is
// committed. Node built-ins only, so it runs before `pnpm install`.
//
// Usage: node preflight.mjs [--queue <name>] [--steps <step,step,...>] [--timeout <seconds>]
//
//   --queue    the checked-in queue the dry run resolves (default nightly-tier5)
//   --steps    the steps to run, always in the fixed order install, build, cli,
//              login, dry-run (default all five)
//   --timeout  seconds one step may run before it is killed and recorded as
//              `timedOut` (default 900), so a hanging install or build still
//              leaves a line
//
// Exit status: 0 when every selected step passed, 1 when a step stopped the
// run by failing or by timing out, 2 on a usage error (nothing is appended).

import { appendFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

const REPO_DIR = resolve(import.meta.dirname, '..', '..', '..')
const PREFLIGHT_PATH = resolve(import.meta.dirname, '..', 'loop', 'preflight.jsonl')
const STEP_ORDER = ['install', 'build', 'cli', 'login', 'dry-run']
const DEFAULT_QUEUE = 'nightly-tier5'
const DEFAULT_TIMEOUT_SECONDS = 900
const TAIL_CHARS = 400
// Credential-shaped strings are cut from a recorded tail before it reaches the repository.
const CREDENTIAL_SHAPES = /\b(?:sk-[A-Za-z0-9_-]{8,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,})\b/g

/**
 * Parses the command line.
 * @param {string[]} argv arguments after the script path
 * @returns {{ queue: string, steps: string[], timeoutSeconds: number }}
 */
function parseArgs(argv) {
  let queue = DEFAULT_QUEUE
  let steps = STEP_ORDER
  let timeoutSeconds = DEFAULT_TIMEOUT_SECONDS
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--queue' && argv[i + 1] !== undefined) queue = argv[++i]
    else if (arg === '--timeout' && argv[i + 1] !== undefined) {
      timeoutSeconds = Number(argv[++i])
      if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) throw new UsageError('--timeout takes a positive number of seconds')
    } else if (arg === '--steps' && argv[i + 1] !== undefined) {
      const named = argv[++i].split(',').map(step => step.trim()).filter(step => step !== '')
      const unknown = named.filter(step => !STEP_ORDER.includes(step))
      if (named.length === 0 || unknown.length > 0) throw new UsageError(`--steps takes a comma-separated subset of ${STEP_ORDER.join(', ')}`)
      steps = STEP_ORDER.filter(step => named.includes(step))
    } else throw new UsageError(`unknown argument: ${arg}`)
  }
  return { queue, steps, timeoutSeconds }
}

class UsageError extends Error {}

/**
 * Runs one command in the repository root and captures its outcome.
 * @param {string} command executable name
 * @param {string[]} args its arguments
 * @param {number} timeoutSeconds seconds before the command is killed and reported as timed out
 * @returns {{ ok: boolean, status: number | null, seconds: number, timedOut?: true, output: string }} `output` is stdout then stderr, or the spawn error's message
 */
function run(command, args, timeoutSeconds) {
  const started = Date.now()
  const result = spawnSync(command, args, {
    cwd: REPO_DIR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutSeconds * 1000, killSignal: 'SIGKILL',
  })
  const seconds = Number(((Date.now() - started) / 1000).toFixed(1))
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (result.error?.code === 'ETIMEDOUT') {
    return { ok: false, status: null, seconds, timedOut: true, output: `${output}\npreflight: ${command} ${args.join(' ')} ran past ${timeoutSeconds} s and was killed\n` }
  }
  if (result.error) return { ok: false, status: null, seconds, output: result.error.message }
  return { ok: result.status === 0, status: result.status, seconds, output }
}

/**
 * Parses the first JSON object in a command's output.
 * @param {string} output the command's output
 * @returns {Record<string, unknown> | null} the object, or null when the output holds none
 */
function parseJsonObject(output) {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(output.slice(start, end + 1))
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    // Anything but a JSON object is reported as a stopped step with its tail.
    return null
  }
}

/**
 * The last characters of an output, with credential-shaped strings cut.
 * @param {string} output the command's output
 * @returns {string} at most TAIL_CHARS characters
 */
function tail(output) {
  return output.slice(-TAIL_CHARS).replace(CREDENTIAL_SHAPES, '[redacted]')
}

/** One preflight step: runs it under the step timeout and returns the fields its ledger entry carries beside `step`. */
const STEPS = {
  install: (queue, timeoutSeconds) => run('pnpm', ['install', '--frozen-lockfile'], timeoutSeconds),
  build: (queue, timeoutSeconds) => run('pnpm', ['run', 'build:lib:host'], timeoutSeconds),
  cli: (queue, timeoutSeconds) => {
    const result = run('claude', ['--version'], timeoutSeconds)
    const version = result.output.trim()
    return { ...result, ok: result.ok && version !== '', version: result.ok ? version : null }
  },
  login: (queue, timeoutSeconds) => {
    const result = run('claude', ['auth', 'status'], timeoutSeconds)
    const status = parseJsonObject(result.output)
    return {
      ...result,
      ok: status?.loggedIn === true,
      loggedIn: typeof status?.loggedIn === 'boolean' ? status.loggedIn : null,
      authMethod: typeof status?.authMethod === 'string' ? status.authMethod : null,
      apiProvider: typeof status?.apiProvider === 'string' ? status.apiProvider : null,
    }
  },
  'dry-run': (queue, timeoutSeconds) => {
    const result = run('pnpm', ['run', 'bench', '--', 'loop', queue, '--dry-run'], timeoutSeconds)
    const entries = /entries=(\d+)/.exec(result.output)
    return { ...result, queue, entries: entries ? Number(entries[1]) : null }
  },
}

/**
 * The repository head the preflight ran on.
 * @returns {string | null} the short hash, or null outside a git checkout
 */
function repositoryHead() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_DIR, encoding: 'utf8' }).trim()
  } catch {
    // A checkout without git history still gets its preflight line; the head is what is unknown.
    return null
  }
}

/**
 * Runs the selected steps in order, appends the line, and reports.
 * @param {string[]} argv arguments after the script path
 * @returns {number} the exit status
 */
function main(argv) {
  const { queue, steps, timeoutSeconds } = parseArgs(argv)
  const pnpm = run('pnpm', ['--version'], timeoutSeconds)
  const recorded = []
  let stoppedAt = null
  for (const step of steps) {
    const { output, ...outcome } = STEPS[step](queue, timeoutSeconds)
    const entry = { step, ...outcome }
    if (!outcome.ok) entry.tail = tail(output)
    recorded.push(entry)
    process.stdout.write(`preflight ${step} ${outcome.ok ? 'ok' : 'stopped'} ${outcome.seconds}s${describe(entry)}\n`)
    if (!outcome.ok) {
      stoppedAt = step
      process.stdout.write(`${entry.tail}\n`)
      break
    }
  }
  const line = {
    ranAt: new Date().toISOString(),
    head: repositoryHead(),
    node: process.version,
    pnpm: pnpm.ok ? pnpm.output.trim() : null,
    queue,
    timeoutSeconds,
    steps: recorded,
    outcome: stoppedAt === null ? 'passed' : 'stopped',
    stoppedAt,
  }
  mkdirSync(join(PREFLIGHT_PATH, '..'), { recursive: true })
  appendFileSync(PREFLIGHT_PATH, `${JSON.stringify(line)}\n`)
  process.stdout.write(`preflight ${line.outcome}${stoppedAt === null ? '' : ` at ${stoppedAt}`}; line appended to ${PREFLIGHT_PATH}\n`)
  return stoppedAt === null ? 0 : 1
}

/**
 * The step-specific fields worth a glance on the console.
 * @param {Record<string, unknown>} entry the recorded step
 * @returns {string} a leading-space suffix, or an empty string
 */
function describe(entry) {
  const shown = ['version', 'loggedIn', 'authMethod', 'entries', 'status', 'timedOut']
    .filter(key => entry[key] !== undefined && entry[key] !== null && !(key === 'status' && entry.status === 0))
    .map(key => `${key}=${String(entry[key])}`)
  return shown.length === 0 ? '' : ` ${shown.join(' ')}`
}

try {
  process.exitCode = main(process.argv.slice(2))
} catch (error) {
  if (!(error instanceof UsageError)) throw error
  process.stderr.write(`preflight: ${error.message}\nusage: node preflight.mjs [--queue <name>] [--steps <step,step,...>] [--timeout <seconds>]\n`)
  process.exitCode = 2
}
