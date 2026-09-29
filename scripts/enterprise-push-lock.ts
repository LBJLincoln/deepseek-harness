/**
 * The push lock every writer of machine commits to the development branch
 * takes: the enterprise shift engine from its fetch and rebase through its
 * recertification to its push, the cycle's `ship()` around its pull and push,
 * and the transcript capture loop around its pull, commit and push. A writer
 * that holds it cannot be overtaken between its fetch and its push by another
 * writer that takes it. The lock is a `flock(1)` lock on one file, so the shell
 * scripts and this module exclude each other.
 *
 * Environment: `ENTERPRISE_PUSH_LOCK` (an absolute path of plain characters,
 * default {@link DEFAULT_PUSH_LOCK}), `ENTERPRISE_PUSH_LOCK_WAIT` (whole
 * seconds a writer waits for the lock, default {@link DEFAULT_PUSH_LOCK_WAIT_SECONDS})
 * and `ENTERPRISE_PUSH_ROUNDS` (push rounds the engine takes while the tip
 * keeps moving, default {@link DEFAULT_PUSH_ROUNDS}).
 */

import { spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'

/** The lock file every writer shares when `ENTERPRISE_PUSH_LOCK` names none. */
export const DEFAULT_PUSH_LOCK = '/tmp/dsh-push.lock'

/**
 * Seconds a writer waits for the lock by default: longer than an engine's
 * recertification under the heavy lock, which is the longest hold.
 */
export const DEFAULT_PUSH_LOCK_WAIT_SECONDS = 1800

/** Push rounds the engine takes by default when a writer that ignores the lock moves the tip. */
export const DEFAULT_PUSH_ROUNDS = 3

/** How one writer takes the push lock and how many rounds it pushes in. */
export interface PushPolicy {
  /** The lock file. */
  readonly lock: string
  /** Whole seconds to wait for the lock before giving up. */
  readonly waitSeconds: number
  /** Push rounds while the tip keeps moving. */
  readonly rounds: number
}

/** A lock path a shell can carry: absolute, and nothing a shell reads specially. */
const LOCK_PATH = /^\/[A-Za-z0-9_@%+=:,./-]+$/

/** One whole number from the environment in `[min, max]`, or the default when unset. */
function wholeNumber(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const text = env[name]
  if (text === undefined || text === '') return fallback
  const value = Number(text)
  if (!/^\d+$/.test(text) || value < min || value > max) throw new Error(`${name} must be a whole number in [${min}, ${max}], got ${JSON.stringify(text)}`)
  return value
}

/**
 * Resolve the push policy from the environment.
 * @param env - the environment to read `ENTERPRISE_PUSH_LOCK`, `ENTERPRISE_PUSH_LOCK_WAIT` and `ENTERPRISE_PUSH_ROUNDS` from.
 * @returns the policy, every unset value defaulted.
 * @throws Error when a value is set and invalid.
 */
export function pushPolicyOf(env: NodeJS.ProcessEnv): PushPolicy {
  const lock = env['ENTERPRISE_PUSH_LOCK'] === undefined || env['ENTERPRISE_PUSH_LOCK'] === '' ? DEFAULT_PUSH_LOCK : env['ENTERPRISE_PUSH_LOCK']
  if (!LOCK_PATH.test(lock)) throw new Error(`ENTERPRISE_PUSH_LOCK must be an absolute path of plain characters, got ${JSON.stringify(lock)}`)
  return {
    lock,
    waitSeconds: wholeNumber(env, 'ENTERPRISE_PUSH_LOCK_WAIT', DEFAULT_PUSH_LOCK_WAIT_SECONDS, 1, 86_400),
    rounds: wholeNumber(env, 'ENTERPRISE_PUSH_ROUNDS', DEFAULT_PUSH_ROUNDS, 1, 20),
  }
}

/**
 * Take the push lock, waiting up to the policy's seconds. The lock is held by
 * an open descriptor of this process, which no child inherits, until the
 * returned release closes it or the process exits.
 * @param policy - the lock file and the wait.
 * @returns the release, or the reason the lock could not be taken.
 */
export function acquirePushLock(policy: PushPolicy): { release: () => void } | { busy: string } {
  mkdirSync(dirname(policy.lock), { recursive: true })
  const fd = openSync(policy.lock, 'a')
  // `flock` locks its descriptor 3, which shares this descriptor's open file
  // description, so the lock outlives `flock` until this descriptor closes.
  const taken = spawnSync('flock', ['--wait', String(policy.waitSeconds), '3'], { stdio: ['ignore', 'ignore', 'pipe', fd], encoding: 'utf8' })
  if (taken.status !== 0) {
    closeSync(fd)
    const detail = taken.error?.message ?? taken.stderr.trim()
    return { busy: `the push lock ${policy.lock} was not taken within ${policy.waitSeconds} s${detail === '' ? '' : `: ${detail}`}` }
  }
  return {
    release: () => {
      closeSync(fd)
    },
  }
}
