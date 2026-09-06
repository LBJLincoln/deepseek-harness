import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import { bwrapProfileArgs } from '../src/profiles.ts'

/**
 * Keyless backend integration through `confine()` and a real bwrap process. With no rung forced,
 * a passing probe must select the first rung. Tests assert world effects, wrap shape, that the
 * kernel denial matches the advertised dialect, and that a denied READ root is actually unreadable
 * inside the confinement; consumer coverage lives in dsh-bash-sandbox.
 * Skips when bwrap or user namespaces are unavailable. HOME-based workspaces avoid bwrap's
 * ephemeral `/tmp`, so workspace-write actually proves the workspace-root rebind.
 */

const probe = spawnSync('bwrap', [...bwrapProfileArgs({ mode: 'read-only', workspaceRoot: '/', deniedReadRoots: [] }), '--', 'true'], { timeout: 5_000, stdio: 'ignore' })
const bwrapUsable = probe.status === 0

let ctx: Context | undefined
const tempDirs: string[] = []
const tempFiles: string[] = []

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  for (const file of tempFiles.splice(0)) rmSync(file, { force: true })
})

async function tempDir(base: string): Promise<string> {
  const dir = await mkdtemp(join(base, 'dsh-bwrap-e2e-'))
  tempDirs.push(dir)
  return dir
}

async function provider(): Promise<LocalSandboxProvider> {
  ctx = new Context()
  await ctx.plugin(LocalSandboxProvider, {})
  return ctx.sandbox as LocalSandboxProvider
}

/** Confine a shell command under `policy` and run it for real; returns the spawn result and the wrap's facts. */
function runConfined(sandbox: LocalSandboxProvider, command: string, policy: SandboxPolicy) {
  const confined = sandbox.confine(['bash', '-c', command], policy)
  const result = spawnSync(confined.argv[0] as string, confined.argv.slice(1), { timeout: 30_000, encoding: 'utf8' })
  return { result, confined }
}

describe.skipIf(!bwrapUsable)('sandbox-local: real bwrap confinement', () => {
  it('the passing probe selects the bwrap rung naturally — first in the ladder, full enforcement, EROFS dialect', async () => {
    const workdir = await tempDir(tmpdir())
    const sandbox = await provider()
    const confined = sandbox.confine(['true'], { mode: 'read-only', workspaceRoot: workdir, deniedReadRoots: [] })
    expect(confined.argv[0]).toBe('bwrap')
    expect(confined.enforcement).toBe('full')
    expect(confined.denialSignatures).toEqual(['read-only file system'])
  })

  it('read-only denies a write — the file must NOT exist, and the kernel speaks the advertised dialect', async () => {
    const workdir = await tempDir(tmpdir())
    const sandbox = await provider()
    const { result } = runConfined(sandbox, `echo hi > ${workdir}/denied.txt`, { mode: 'read-only', workspaceRoot: workdir, deniedReadRoots: [] })
    expect(result.status).not.toBe(0)
    // The wrap's denialSignatures must be what the kernel actually prints.
    expect(result.stderr.toLowerCase()).toContain('read-only file system')
    expect(existsSync(join(workdir, 'denied.txt'))).toBe(false)
  })

  it('read-only keeps the tree readable/executable and the fresh /dev/null writable', async () => {
    const workdir = await tempDir(tmpdir())
    const sandbox = await provider()
    const { result } = runConfined(sandbox, 'ls / > /dev/null && echo dev-ok', { mode: 'read-only', workspaceRoot: workdir, deniedReadRoots: [] })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('dev-ok\n')
  })

  it('workspace-write lands a write inside the workspace root and still denies one beside it', async () => {
    const workdir = await tempDir(homedir())
    const outside = await tempDir(homedir())
    const sandbox = await provider()

    const inside = runConfined(sandbox, `printf bwrap-ok > ${workdir}/allowed.txt`, { mode: 'workspace-write', workspaceRoot: workdir, deniedReadRoots: [] })
    expect(inside.result.status).toBe(0)
    expect(readFileSync(join(workdir, 'allowed.txt'), 'utf8')).toBe('bwrap-ok')

    const denied = runConfined(sandbox, `echo hi > ${outside}/denied.txt`, { mode: 'workspace-write', workspaceRoot: workdir, deniedReadRoots: [] })
    expect(denied.result.status).not.toBe(0)
    expect(existsSync(join(outside, 'denied.txt'))).toBe(false)
  })

  it('workspace-write mounts an EPHEMERAL /tmp: the write succeeds inside, the host /tmp stays untouched', async () => {
    // The documented bwrap-profile difference: Landlock and Seatbelt grant
    // the HOST temp areas, bwrap swaps in a fresh tmpfs that dies with the
    // process — the strongest of the three temp semantics.
    const workdir = await tempDir(homedir())
    const target = `/tmp/dsh-bwrap-e2e-ephemeral-${process.pid}.txt`
    tempFiles.push(target)
    const sandbox = await provider()
    const { result } = runConfined(sandbox, `printf tmp-ok > ${target} && cat ${target}`, { mode: 'workspace-write', workspaceRoot: workdir, deniedReadRoots: [] })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('tmp-ok')
    expect(existsSync(target)).toBe(false)
  })

  it('a denied read root is unreadable inside the confinement while the host still reads it', async () => {
    // The read barrier's property, proved through the executor: a process the
    // provider confined cannot read the validator's standard, and the same file
    // is plainly readable outside — the denial is the confinement, not the file.
    const workdir = await tempDir(homedir())
    const denied = await tempDir(homedir())
    const standard = join(denied, 'standard.json')
    await writeFile(standard, '{"checks":[{"id":"marker","run":"test -f MARKER"}]}\n')
    const sandbox = await provider()

    const { result } = runConfined(sandbox, `cat ${standard}`, {
      mode: 'workspace-write',
      workspaceRoot: workdir,
      deniedReadRoots: [denied],
    })

    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(readFileSync(standard, 'utf8')).toContain('marker')
    // The denied directory itself is still there, as an empty tmpfs: the
    // confinement replaces the contents rather than the path.
    const listing = runConfined(sandbox, `ls -A ${denied}`, {
      mode: 'workspace-write',
      workspaceRoot: workdir,
      deniedReadRoots: [denied],
    })
    expect(listing.result.status).toBe(0)
    expect(listing.result.stdout).toBe('')
  })

  it('reads a workspace file the barrier does not deny in the same confinement', async () => {
    const workdir = await tempDir(homedir())
    const denied = await tempDir(homedir())
    const work = join(workdir, 'work.txt')
    await writeFile(work, 'implementer work\n')
    const sandbox = await provider()
    const { result } = runConfined(sandbox, `cat ${work}`, {
      mode: 'workspace-write',
      workspaceRoot: workdir,
      deniedReadRoots: [denied],
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('implementer work\n')
  })
})
