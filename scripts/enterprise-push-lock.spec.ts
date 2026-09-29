/**
 * The push lock (`scripts/enterprise-push-lock.ts`): its policy from the
 * environment, and a writer that holds it from its fetch to its push is not
 * overtaken by a concurrent pusher that takes the same lock the way the cycle's
 * `ship()` and the transcript capture loop do, while the same pusher without
 * the lock held overtakes it.
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acquirePushLock, DEFAULT_PUSH_LOCK, DEFAULT_PUSH_LOCK_WAIT_SECONDS, DEFAULT_PUSH_ROUNDS, pushPolicyOf } from './enterprise-push-lock.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd()
}

/** A bare remote with one commit on `main` and two clones of it, each with one commit of its own to push. */
function writers(): { remote: string; engine: string; other: string; lock: string } {
  const root = tempDir('push-lock-')
  const remote = join(root, 'origin.git')
  const seed = join(root, 'seed')
  git(root, 'init', '-q', '--bare', '-b', 'main', remote)
  git(root, 'clone', '-q', remote, seed)
  writeFileSync(join(seed, 'README.md'), 'seed\n')
  git(seed, 'add', '-A')
  git(seed, 'commit', '-qm', 'seed')
  git(seed, 'push', '-q', 'origin', 'HEAD:main')
  const clone = (name: string): string => {
    const dir = join(root, name)
    git(root, 'clone', '-q', remote, dir)
    writeFileSync(join(dir, `${name}.txt`), `${name}\n`)
    git(dir, 'add', '-A')
    git(dir, 'commit', '-qm', name)
    return dir
  }
  return { remote, engine: clone('engine'), other: clone('other'), lock: join(root, 'push.lock') }
}

/** A pusher that takes the lock as the cycle's `ship()` does: flock, then pull --rebase and push; 75 when the lock was not taken. */
function lockedPusher(cwd: string, lock: string, waitSeconds: number): Promise<number | null> {
  const script = `( flock -w ${waitSeconds} 6 || exit 75; git -c user.name=t -c user.email=t@example.test pull -q --rebase origin main && git push -q origin HEAD:main ) 6>>"$LOCK"`
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', script], { cwd, env: { ...process.env, LOCK: lock }, stdio: 'ignore' })
    child.on('error', reject)
    child.on('close', resolve)
  })
}

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** Whether util-linux `flock`, which the lock is taken with, is on this host. */
const hasFlock = process.platform === 'linux' && spawnSync('flock', ['--version']).status === 0

describe('pushPolicyOf', () => {
  it('defaults every unset value and refuses a bad one', () => {
    expect(pushPolicyOf({})).toEqual({ lock: DEFAULT_PUSH_LOCK, waitSeconds: DEFAULT_PUSH_LOCK_WAIT_SECONDS, rounds: DEFAULT_PUSH_ROUNDS })
    expect(pushPolicyOf({ ENTERPRISE_PUSH_LOCK: '/run/x.lock', ENTERPRISE_PUSH_LOCK_WAIT: '60', ENTERPRISE_PUSH_ROUNDS: '5' })).toEqual({ lock: '/run/x.lock', waitSeconds: 60, rounds: 5 })
    expect(() => pushPolicyOf({ ENTERPRISE_PUSH_LOCK: 'relative.lock' })).toThrow(/absolute path/)
    expect(() => pushPolicyOf({ ENTERPRISE_PUSH_LOCK_WAIT: '1.5' })).toThrow(/ENTERPRISE_PUSH_LOCK_WAIT/)
    expect(() => pushPolicyOf({ ENTERPRISE_PUSH_ROUNDS: '0' })).toThrow(/ENTERPRISE_PUSH_ROUNDS/)
  })
})

describe.skipIf(!hasFlock)('acquirePushLock', () => {
  it('reports a lock another writer holds as busy after the wait, and takes it once released', () => {
    const { lock } = writers()
    const held = acquirePushLock({ lock, waitSeconds: 1, rounds: 1 })
    if (!('release' in held)) throw new Error(held.busy)
    expect(spawnSync('flock', ['-w', '1', lock, 'true']).status).toBe(1)
    const second = acquirePushLock({ lock, waitSeconds: 1, rounds: 1 })
    expect(second).toEqual({ busy: `the push lock ${lock} was not taken within 1 s` })
    held.release()
    const third = acquirePushLock({ lock, waitSeconds: 1, rounds: 1 })
    expect('release' in third).toBe(true)
    if ('release' in third) third.release()
  })

  it('keeps a lock-respecting pusher out between the holder\'s fetch and its push', { timeout: 30_000 }, async () => {
    const { remote, engine, other, lock } = writers()
    const held = acquirePushLock({ lock, waitSeconds: 5, rounds: 1 })
    if (!('release' in held)) throw new Error(held.busy)
    git(engine, 'fetch', '-q', 'origin', 'main')
    const fetched = git(engine, 'rev-parse', 'FETCH_HEAD')
    const pusher = lockedPusher(other, lock, 20)
    // The holder's rebase and recertification window, in which the pusher is waiting on the lock.
    await delay(1500)
    expect(git(remote, 'rev-parse', 'main')).toBe(fetched)
    git(engine, 'rebase', '-q', 'FETCH_HEAD')
    expect(spawnSync('git', ['push', '-q', 'origin', 'HEAD:main'], { cwd: engine }).status).toBe(0)
    const shipped = git(engine, 'rev-parse', 'HEAD')
    held.release()
    expect(await pusher).toBe(0)
    expect(git(remote, 'log', '--format=%s', 'main')).toBe('other\nengine\nseed')
    expect(git(remote, 'rev-parse', 'main^')).toBe(shipped)
  })

  it('without the lock held, the same pusher overtakes the writer and its push is refused', { timeout: 30_000 }, async () => {
    const { remote, engine, other, lock } = writers()
    git(engine, 'fetch', '-q', 'origin', 'main')
    const fetched = git(engine, 'rev-parse', 'FETCH_HEAD')
    expect(await lockedPusher(other, lock, 20)).toBe(0)
    expect(git(remote, 'rev-parse', 'main')).not.toBe(fetched)
    git(engine, 'rebase', '-q', 'FETCH_HEAD')
    const refused = spawnSync('git', ['push', '-q', 'origin', 'HEAD:main'], { cwd: engine, encoding: 'utf8' })
    expect(refused.status).not.toBe(0)
    expect(refused.stderr).toContain('rejected')
  })
})
