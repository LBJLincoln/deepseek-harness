/**
 * Thin CLI wrapper around the enterprise shift driver
 * (`examples/headless-agent/tests/fixtures/enterprise-shift/driver.ts`):
 * argument validation, the scratch directory, the composition, and process
 * execution with the driver's output teed into `run.log`. It adds no selection,
 * review, or shipping logic of its own — the driver owns the shift.
 *
 *   pnpm run enterprise -- shift [--next <n> | --tickets <id,...>] [--implementer route|subagent]
 *                                [--model <id>] [--push] [--branch <name>] [--composition <path>]
 *                                [--scratch <dir>] [--keep]
 *
 * One shift clones the development branch tip from `origin`, runs one program
 * whose departments are the selected tickets, reviews, assembles, recertifies,
 * and, with `--push`, ships the result fast-forward to that branch with the
 * shift's ledger lines and record. `DSH_ENTERPRISE_SCRATCH` sets the directory
 * the shift clones under when `--scratch` does not; `ENTERPRISE_HEAVY_LOCK`
 * reaches the driver with the rest of the environment and names the lock its
 * heavy acceptance runs take, so the command itself is never run under it.
 */

import { execFileSync, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

export const REPO_ROOT = resolve(import.meta.dirname, '..')
export const SHIFT_FIXTURE = join(REPO_ROOT, 'examples/headless-agent/tests/fixtures/enterprise-shift')
export const REAL_COMPOSITION = join(SHIFT_FIXTURE, 'overlays/claude-code.cordis.yml')

/** The branch the enterprise develops on and ships to. */
export const DEVELOPMENT_BRANCH = 'claude/coding-agent-harness-u9l4gt'

/** The subcommand as parsed from the command line. */
export interface ShiftCommand {
  readonly kind: 'shift'
  readonly next: number | undefined
  readonly tickets: string | undefined
  readonly implementer: 'route' | 'subagent'
  readonly model: string | undefined
  readonly push: boolean
  readonly branch: string
  readonly composition: string
  readonly scratch: string
  readonly keep: boolean
}

const USAGE = `usage: pnpm run enterprise -- shift [--next <n> | --tickets <id,...>] [--implementer route|subagent] [--model <id>] [--push] [--branch <name>] [--composition <path>] [--scratch <dir>] [--keep]

shift runs one enterprise shift: it clones the tip of the development branch, works the selected open tickets through one program, reviews and assembles the approved ones, recertifies the assembled tree, and with --push ships it fast-forward with the shift's ledger lines and record.
`

/**
 * Parse the command line.
 * @param argv - arguments after the script path.
 * @param env - the environment, for the scratch default.
 * @returns the command.
 * @throws on an unknown subcommand, an unknown option, or a selection that is not exactly one of `--next` and `--tickets`.
 */
export function parseCommand(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): ShiftCommand {
  // `pnpm run enterprise -- shift …` forwards the `--` itself.
  const [sub, ...rest] = argv[0] === '--' ? argv.slice(1) : argv
  if (sub === undefined || sub === '--help' || sub === '-h') throw new Error(USAGE)
  if (sub !== 'shift') throw new Error(`unknown subcommand '${sub}'; expected shift`)
  const { values } = parseArgs({
    args: [...rest],
    allowPositionals: false,
    options: {
      next: { type: 'string' },
      tickets: { type: 'string' },
      implementer: { type: 'string', default: 'route' },
      model: { type: 'string' },
      push: { type: 'boolean', default: false },
      branch: { type: 'string', default: DEVELOPMENT_BRANCH },
      composition: { type: 'string', default: REAL_COMPOSITION },
      scratch: { type: 'string' },
      keep: { type: 'boolean', default: false },
    },
  })
  if ((values.next === undefined) === (values.tickets === undefined)) throw new Error('shift takes exactly one of --next <n> and --tickets <id,...>')
  const next = values.next === undefined ? undefined : Number(values.next)
  if (next !== undefined && (!Number.isInteger(next) || next < 1)) throw new Error('--next takes a positive integer')
  if (values.implementer !== 'route' && values.implementer !== 'subagent') throw new Error(`--implementer must be route or subagent, got ${values.implementer}`)
  return {
    kind: 'shift',
    next,
    tickets: values.tickets,
    implementer: values.implementer,
    model: values.model,
    push: values.push,
    branch: values.branch,
    composition: resolve(process.cwd(), values.composition),
    scratch: resolve(process.cwd(), values.scratch ?? env['DSH_ENTERPRISE_SCRATCH'] ?? join(tmpdir(), 'dsh-enterprise')),
    keep: values.keep,
  }
}

/** The lock file one running shift holds under the scratch root. */
export const LOCK_FILE = 'shift.lock'

/** Exit code of a shift refused because another one holds the lock. */
export const LOCKED_EXIT_CODE = 4

/** Age past which a finished shift's clone is swept from the scratch root. */
const CLONE_RETENTION_MS = 24 * 60 * 60 * 1000

/** Whether a process id names a live process this user can signal. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    // ESRCH: no such process; the lock its holder left is stale.
    return false
  }
}

/**
 * Claim the scratch root for one shift: `shift.lock` names the holder's pid
 * and shift. A lock whose holder is still alive refuses the shift; one whose
 * holder died is replaced, so an interrupted shift never blocks the next.
 * @param scratch - the scratch root every shift of this checkout clones under.
 * @param shift - the claiming shift's id.
 * @returns the release, which removes the lock.
 * @throws when a live shift holds the lock; the message names it.
 */
export function acquireLock(scratch: string, shift: string): () => void {
  mkdirSync(scratch, { recursive: true })
  const path = join(scratch, LOCK_FILE)
  const claim = `${JSON.stringify({ pid: process.pid, shift, startedAt: new Date().toISOString() })}\n`
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(path, claim, { flag: 'wx' })
      return (): void => {
        rmSync(path, { force: true })
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const holder = JSON.parse(readFileSync(path, 'utf8')) as { pid: number; shift: string }
    if (alive(holder.pid)) throw new Error(`a shift is already running: ${holder.shift} (pid ${String(holder.pid)}) holds ${path}`)
    rmSync(path, { force: true })
  }
  throw new Error(`could not claim ${path}`)
}

/**
 * Remove the clones of earlier shifts under the scratch root once they are a
 * day old, keeping each shift's `run.log` and session logs. A clone is kept
 * when its shift pushed nothing, and a day is long enough for an operator to
 * read it; an unattended schedule cannot keep every clone on a shared disk.
 * @param scratch - the scratch root.
 * @param now - the sweep instant.
 * @returns the clones removed.
 */
export function sweepClones(scratch: string, now: Date): string[] {
  if (!existsSync(scratch)) return []
  const removed: string[] = []
  for (const entry of readdirSync(scratch, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const repo = join(scratch, entry.name, 'repo')
    if (!existsSync(repo)) continue
    if (now.getTime() - statSync(repo).mtimeMs < CLONE_RETENTION_MS) continue
    rmSync(repo, { recursive: true, force: true })
    removed.push(repo)
  }
  return removed
}

/** The tsx binary this workspace installed. */
function tsxBinary(): string {
  const binary = join(REPO_ROOT, 'node_modules', '.bin', 'tsx')
  if (!existsSync(binary)) throw new Error(`tsx is not installed at ${binary}; run pnpm install`)
  return binary
}

/**
 * The environment the driver reads: the remote is this repository's `origin`
 * and the clone borrows this repository's objects.
 * @param command - the parsed command.
 * @param shift - the shift id, which names the scratch directory.
 * @returns the environment additions.
 */
export function driverEnvironment(command: ShiftCommand, shift: string): Record<string, string> {
  const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
  // The common git dir holds the objects whether this checkout is the main
  // one or a linked worktree, whose own `.git` is a file a clone cannot borrow from.
  const reference = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
  return {
    DSH_ENTERPRISE_REMOTE: remote,
    DSH_ENTERPRISE_BRANCH: command.branch,
    DSH_ENTERPRISE_REFERENCE: reference,
    DSH_ENTERPRISE_SCRATCH: join(command.scratch, shift),
    DSH_ENTERPRISE_SHIFT: shift,
    DSH_ENTERPRISE_IMPLEMENTER: command.implementer,
    ...command.next === undefined ? {} : { DSH_ENTERPRISE_NEXT: String(command.next) },
    ...command.tickets === undefined ? {} : { DSH_ENTERPRISE_TICKETS: command.tickets },
    ...command.model === undefined ? {} : { DSH_ENTERPRISE_MODEL: command.model },
    ...command.push ? { DSH_ENTERPRISE_PUSH: '1' } : {},
    ...command.keep ? { DSH_ENTERPRISE_KEEP: '1' } : {},
  }
}

/**
 * A shift id from the launch instant: the UTC clock time and a random suffix.
 * @param now - the launch instant.
 * @returns `hhmmss-<4 hex>`.
 */
export function shiftId(now: Date): string {
  const suffix = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')
  return `${now.toISOString().slice(11, 19).replaceAll(':', '')}-${suffix}`
}

/** Run the driver with its stdout and stderr teed into `run.log`, and return its exit code. */
function runDriver(command: ShiftCommand, env: Record<string, string>): Promise<number> {
  const scratch = env['DSH_ENTERPRISE_SCRATCH'] ?? command.scratch
  mkdirSync(scratch, { recursive: true })
  const log = createWriteStream(join(scratch, 'run.log'), { flags: 'a' })
  log.write(`=== ${new Date().toISOString()} shift=${env['DSH_ENTERPRISE_SHIFT'] ?? ''} branch=${command.branch} composition=${command.composition} ===\n`)
  return new Promise((resolveExit, reject) => {
    const child: ChildProcess = spawn(tsxBinary(), [join(SHIFT_FIXTURE, 'driver.ts'), command.composition], {
      cwd: REPO_ROOT,
      env: { ...process.env, TSX_TSCONFIG_PATH: join(REPO_ROOT, 'tsconfig.json'), ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    // A signal to this wrapper ends the driver with it, so the lock it holds
    // is released by a shift that is no longer running.
    const forward = (): void => {
      child.kill('SIGTERM')
    }
    process.once('SIGTERM', forward)
    process.once('SIGINT', forward)
    child.stdout?.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk)
      log.write(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk)
      log.write(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      process.off('SIGTERM', forward)
      process.off('SIGINT', forward)
      log.end()
      resolveExit(code ?? 1)
    })
  })
}

if (import.meta.main) {
  let release: (() => void) | undefined
  try {
    const command = parseCommand(process.argv.slice(2))
    const shift = shiftId(new Date())
    const env = driverEnvironment(command, shift)
    try {
      release = acquireLock(command.scratch, shift)
    } catch (error: unknown) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = LOCKED_EXIT_CODE
    }
    if (release !== undefined) {
      for (const repo of sweepClones(command.scratch, new Date())) process.stdout.write(`enterprise: swept ${repo}\n`)
      process.stdout.write(`enterprise: shift ${shift} → ${env['DSH_ENTERPRISE_SCRATCH'] ?? ''}\n`)
      process.exitCode = await runDriver(command, env)
    }
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  } finally {
    release?.()
  }
}
