/**
 * Service tests over the real local filesystem provider: root creation, run
 * reservations and the role they confer, registered denied directories, the
 * containment decision, and the durable refusal record.
 */

import { mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FileSystem, FsError, FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import type { FsDirEntry, FsEditOutcome, FsInfo, FsPathInfo, FsTarget, FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import ReadBarrierService, { READ_BARRIER_DENIED_VERSION, RUNS_DIR } from '../src/index.ts'
import type { Config } from '../src/index.ts'

const roots: string[] = []

function tempRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  roots.push(root)
  return root
}

/** A provider whose `resolve` always fails, so containment cannot be decided. */
class UnresolvableFs extends FileSystem {
  override async resolve(path: string): Promise<FsTarget> {
    throw new FsError(`cannot resolve ${path}`, 'FS_IO_ERROR')
  }
  override processPath(target: FsTarget): string { return String(target.targetKey) }
  override fileUrl(target: FsTarget): string { return `file://${target.targetKey}` }
  override contains(): boolean { return false }
  override async stat(): Promise<FsInfo | undefined> { return undefined }
  override async lstat(): Promise<FsPathInfo | undefined> { return undefined }
  override async readText(): Promise<string> { return '' }
  override async streamText(): Promise<AsyncIterable<string>> { return (async function* () {})() }
  override async readBytes(): Promise<Uint8Array> { return new Uint8Array() }
  override async listDir(): Promise<FsDirEntry[]> { return [] }
  override async writeText(): Promise<FsWriteOutcome> {
    return { operation: 'create', version: FsVersion('v1'), before: null, after: '' }
  }
  override async editText(): Promise<FsEditOutcome> {
    return { version: FsVersion('v1'), before: '', after: '' }
  }
}

async function setup(config: Config, provider: typeof LocalFileSystem | typeof UnresolvableFs = LocalFileSystem, cwd = tmpdir()) {
  const ctx = new Context()
  await ctx.plugin(provider as typeof LocalFileSystem, { cwd })
  await ctx.plugin(ReadBarrierService, config)
  return ctx
}

function agentWithSession(id: string): Agent & { session: Session } {
  const session = Session.create(SessionId(id))
  return { id: SessionId(id), session } as unknown as Agent & { session: Session }
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots.length = 0
})

describe('barrier root', () => {
  it('creates the configured root owner-only', async () => {
    const root = join(tempRoot('dsh-read-barrier-root-'), 'verification')
    const ctx = await setup({ root })
    expect(ctx.readBarrier.root).toBe(root)
    expect(statSync(root).isDirectory()).toBe(true)
    if (process.platform !== 'win32') expect(statSync(root).mode & 0o077).toBe(0)
  })

  it('expands a "~"-prefixed root against the harness home', async () => {
    const home = tempRoot('dsh-read-barrier-home-')
    const previous = process.env['DSH_HOME']
    process.env['DSH_HOME'] = home
    try {
      const ctx = await setup({})
      expect(ctx.readBarrier.root).toBe(join(home, 'verification'))
    } finally {
      if (previous === undefined) delete process.env['DSH_HOME']
      else process.env['DSH_HOME'] = previous
    }
  })

  it('refuses a relative root and a relative denied directory', async () => {
    await expect(setup({ root: 'verification' })).rejects.toThrow(
      'read-barrier: root "verification" must be an absolute or "~"-prefixed directory',
    )
    await expect(setup({ root: tempRoot('dsh-read-barrier-relative-'), denyRoots: ['sessions'] })).rejects.toThrow(
      'read-barrier: denyRoots entry "sessions" must be an absolute or "~"-prefixed directory',
    )
  })
})

describe('reservations and roles', () => {
  it('mints one owner-only run directory per session and reuses it', async () => {
    const root = tempRoot('dsh-read-barrier-reserve-')
    const ctx = await setup({ root })
    const agent = agentWithSession('run-1')
    const directory = ctx.readBarrier.reserve(agent)
    expect(directory).toBe(join(root, RUNS_DIR, 'run-1'))
    expect(ctx.readBarrier.reserve(agent)).toBe(directory)
    if (process.platform !== 'win32') expect(statSync(directory).mode & 0o077).toBe(0)
  })

  it('makes a reserved session the implementer and leaves every other session unrestricted', async () => {
    const root = tempRoot('dsh-read-barrier-role-')
    const ctx = await setup({ root })
    const reserved = agentWithSession('reserved')
    const other = agentWithSession('other')
    ctx.readBarrier.reserve(reserved)
    expect(ctx.readBarrier.resolve({ session: reserved.session }).role).toBe('implementer')
    expect(ctx.readBarrier.resolve({ session: other.session }).role).toBe('unrestricted')
    expect(ctx.readBarrier.resolve().role).toBe('unrestricted')
  })

  it('drops the reservation when the agent is disposed', async () => {
    const root = tempRoot('dsh-read-barrier-dispose-')
    const ctx = await setup({ root })
    const agent = agentWithSession('disposed')
    ctx.readBarrier.reserve(agent)
    expect(ctx.readBarrier.resolve({ session: agent.session }).role).toBe('implementer')
    ctx.emit('agent/disposed', { agent })
    expect(ctx.readBarrier.resolve({ session: agent.session }).role).toBe('unrestricted')
  })
})

describe('denied directories', () => {
  it('lists the root, the configured extras, and each registration once', async () => {
    const root = tempRoot('dsh-read-barrier-denied-')
    const extra = tempRoot('dsh-read-barrier-extra-')
    const store = tempRoot('dsh-read-barrier-store-')
    const ctx = await setup({ root, denyRoots: [extra] })
    expect(ctx.readBarrier.resolve().denied).toEqual([root, extra])
    const first = ctx.readBarrier.protect(store)
    const second = ctx.readBarrier.protect(store)
    expect(ctx.readBarrier.resolve().denied).toEqual([root, extra, store])
    first()
    expect(ctx.readBarrier.resolve().denied).toEqual([root, extra, store])
    second()
    expect(ctx.readBarrier.resolve().denied).toEqual([root, extra])
  })

  it('refuses a relative protected directory', async () => {
    const ctx = await setup({ root: tempRoot('dsh-read-barrier-protect-') })
    expect(() => ctx.readBarrier.protect('sessions')).toThrow(
      'read-barrier: protect path "sessions" must be an absolute or "~"-prefixed directory',
    )
  })
})

describe('the deny decision', () => {
  it('denies an implementer every denied tree and nothing else', async () => {
    const root = tempRoot('dsh-read-barrier-decide-')
    const workspace = tempRoot('dsh-read-barrier-workspace-')
    const ctx = await setup({ root })
    await mkdir(join(root, 'runs', 'r1'), { recursive: true })
    await writeFile(join(root, 'runs', 'r1', 'check'), 'true\n')
    await writeFile(join(workspace, 'src.txt'), 'work\n')
    const inside = await ctx.fs.resolve(join(root, 'runs', 'r1', 'check'))
    const outside = await ctx.fs.resolve(join(workspace, 'src.txt'))
    const implementer = { role: 'implementer' as const, root, denied: [root] }
    expect(await ctx.readBarrier.denies(implementer, inside)).toBe(true)
    expect(await ctx.readBarrier.denies(implementer, outside)).toBe(false)
  })

  it('denies the barrier root itself, not only its descendants', async () => {
    const root = tempRoot('dsh-read-barrier-self-')
    const ctx = await setup({ root })
    const target = await ctx.fs.resolve(root)
    expect(await ctx.readBarrier.denies({ role: 'implementer', root, denied: [root] }, target)).toBe(true)
  })

  it.each(['validator', 'unrestricted'] as const)('denies a %s session nothing', async (role) => {
    const root = tempRoot('dsh-read-barrier-open-')
    const ctx = await setup({ root })
    const target = await ctx.fs.resolve(root)
    expect(await ctx.readBarrier.denies({ role, root, denied: [root] }, target)).toBe(false)
  })

  it('denies a target whose containment cannot be decided', async () => {
    const root = tempRoot('dsh-read-barrier-undecidable-')
    const ctx = await setup({ root }, UnresolvableFs)
    const target = { targetKey: FsTargetKey('unrelated'), displayPath: '/unrelated' }
    expect(await ctx.readBarrier.denies({ role: 'implementer', root, denied: [root] }, target)).toBe(true)
  })
})

describe('the durable refusal record', () => {
  it('appends the refusal and returns the payload it appended', async () => {
    const root = tempRoot('dsh-read-barrier-record-')
    const ctx = await setup({ root })
    const agent = agentWithSession('recorded')
    ctx.readBarrier.reserve(agent)
    const policy = ctx.readBarrier.resolve({ session: agent.session })
    const target = await ctx.fs.resolve(join(root, RUNS_DIR, 'recorded'))
    const denial = ctx.readBarrier.recordDenial(agent.session, policy, 'fs', target)
    expect(denial).toEqual({
      version: READ_BARRIER_DENIED_VERSION,
      role: 'implementer',
      capability: 'fs',
      displayPath: target.displayPath,
      root,
    })
    expect(agent.session.events.map(event => event.type)).toEqual(['read-barrier/denied'])
    expect(agent.session.events[0]?.data).toEqual(denial)
  })
})
